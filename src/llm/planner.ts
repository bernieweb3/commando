import { chat } from './openrouter';
import { ToolContext } from '../skills/loader';
import { PlannerError } from '../utils/errors';
import { log } from '../utils/logger';
import { getEffectiveLLM } from '../config/userConfig';
import { toolFilename, TOOL_BASENAMES, ToolBase } from '../bootstrap/platform';

// A `Plan` is the LLM's final answer: the executable name + explicit argv.
// We deliberately do NOT allow shell strings here - everything is an array
// that can be handed directly to `child_process.spawn(..., { shell: false })`.
export interface Plan {
  binary: string; // e.g. "sui.exe" on Windows, "sui" on Unix
  args: string[]; // argv items; can be positional or flags
}

// The exact filename the LLM should emit varies per platform. We precompute
// the quoted list once so the system prompt renders with the platform-correct
// set (e.g. "sui", "walrus", "site-builder" on Unix).
const BINARY_LIST_QUOTED = TOOL_BASENAMES.map(
  (b) => `"${toolFilename(b as ToolBase)}"`,
).join(', ');

const SYSTEM_PROMPT = (tool: string, section: string) => `You are a strict command planner for ${tool}.

Hard rules:
  1. Output MUST be a single JSON object with exactly two fields:
       - "binary": one of ${BINARY_LIST_QUOTED}.
       - "args":   an array of strings (each argv element separate - do NOT join with spaces).
  2. No prose, no markdown fences, no comments. Return raw JSON only.
  3. Pick the most specific command path from the skill context. If the
     skill context lists both a command group (e.g. "sui client") and its
     subcommand (e.g. "sui client active-address"), you MUST use the
     subcommand whenever the user's request matches it. Never stop at a
     command group when a leaf subcommand fits.
  4. The flag tokens after each command in the skill context are the set
     of flags that command ACCEPTS - they are NOT required. Add a flag
     ONLY when the user's request clearly needs it. Do NOT include both a
     long flag and its short alias (e.g. never emit "--quiet" and "-q"
     together; never emit "--help" and "-h" together).
  5. If the user asks for JSON / machine-readable output, add "--json"
     when (and only when) it appears in that command's flag list.
  6. Never invent flags or commands that do not appear verbatim in the
     skill context.
  7. POSITIONAL ARGUMENTS: some commands require positional values (for
     example "sui client new-address <KEY_SCHEME>" needs "ed25519", or
     "walrus store <FILE>" needs a file path). When the user's request
     clearly provides such a value, include it as a SEPARATE element of
     the "args" array AFTER the command tokens and BEFORE any flags. Do
     not prefix positional values with dashes; write them literally
     (e.g. "ed25519", not "--key ed25519"). If the user did not provide
     a positional value the command requires, still emit the base command
     so the tool prints its own usage error - do NOT invent a value.
  8. ADDRESSES & HASHES: when the user's prompt contains a Sui-style
     0x... address, a blob id, a transaction digest, or an object id,
     treat it as a positional argument or the value of the matching flag
     if one exists (e.g. "--address 0x...", "--blob-id ..."). Never
     truncate, rewrap, or uppercase these values.
  9. BUILD vs PUBLISH vs TEST (Move / Sui packages). These are DIFFERENT
     verbs and different commands. Do NOT conflate them:
       - "build", "compile", "check"              => sui move build
       - "test", "run tests", "unit test"         => sui move test
       - "publish", "deploy", "push", "upload package",
         "deploy contract", "ship to testnet"     => sui client publish
       - "new package", "scaffold"                => sui move new <NAME>
     "publish" costs real gas; "build" and "test" do not. If the user
     says "build" (not "publish"), you MUST emit "sui move build" even
     if the skill context also lists "sui client publish".
 10. WALRUS COMMON VERBS. For the walrus tool:
       - "upload", "store", "put a file", "send blob" => walrus store
       - "download", "read", "fetch blob"             => walrus read
       - "list my blobs", "show blobs"                => walrus list-blobs
       - "delete blob"                                => walrus delete
       - "exchange sui for wal", "get wal"            => walrus get-wal
     Keep the same strict rule as rule 6: never emit a command that is
     not listed verbatim in the skill context for walrus.

Skill context for "${tool}" (use these commands and flags only):
---
${section}
---
`;

// The only binaries the planner is allowed to target. Anything else gets
// rejected at parse time so we don't spend a safety-gate cycle on it.
// Computed per-platform: on Windows this resolves to {sui.exe, walrus.exe,
// site-builder.exe}, on Unix to {sui, walrus, site-builder}.
const ALLOWED_BINARIES = new Set(
  TOOL_BASENAMES.map((b) => toolFilename(b as ToolBase)),
);

// Normalize what the LLM emits into a canonical binary name. Models often
// drop or add the .exe suffix inconsistently ("sui" vs "sui.exe") or use
// the wrong case. We accept both shapes, strip any `.exe`, then re-attach
// the platform-correct suffix from toolFilename() before checking the
// allowlist. That way the exact same model output works on Windows and
// Unix without the LLM having to know about the host OS.
function normalizeBinary(raw: string): string | null {
  const trimmed = raw.trim();
  const base = trimmed.split(/[\\/]/).pop() || trimmed;
  const lower = base.toLowerCase();
  const bare = lower.replace(/\.exe$/, '');
  if (!(TOOL_BASENAMES as ReadonlyArray<string>).includes(bare)) return null;
  const canonical = toolFilename(bare as ToolBase);
  return ALLOWED_BINARIES.has(canonical) ? canonical : null;
}

// Best-effort JSON extraction. Real-world LLM outputs we've seen in the
// wild that break naive JSON.parse:
//   - wrapped in ```json ... ``` fences
//   - preceded by chain-of-thought prose ("Let me think... { ... }")
//   - followed by trailing explanation ("{ ... } // this runs client faucet")
//   - smart quotes instead of ASCII quotes
// The strategy: strip obvious markdown fences, then if a raw JSON.parse
// still fails, fall back to extracting the first balanced {...} block in
// the text. This is intentionally a single-retry heuristic - we do not
// attempt to repair malformed JSON.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseJson(raw: string): Plan | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    // Normalize curly / smart quotes that some models emit.
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();

  // Candidates to try in order: the full cleaned text, then the first
  // balanced {...} substring (covers "prose then JSON" outputs).
  const candidates: string[] = [cleaned];
  const extracted = extractFirstJsonObject(cleaned);
  if (extracted && extracted !== cleaned) candidates.push(extracted);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (
        typeof parsed?.binary === 'string' &&
        Array.isArray(parsed?.args) &&
        parsed.args.every((a: unknown) => typeof a === 'string')
      ) {
        const binary = normalizeBinary(parsed.binary);
        if (!binary) return null;
        return { binary, args: parsed.args };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

export type PlanValidation =
  | { ok: true }
  | { ok: false; kind: 'flag'; offending: string[] }
  | { ok: false; kind: 'command'; attempted: string; suggestions: string[] };

// Validate that an LLM-produced plan stays within the skill context. We
// check TWO things:
//
//   (a) Command path. The leading non-flag tokens of `args` must form a
//       prefix of some entry in ctx.allowedCommands. This is the fix for
//       the "sui client test-publish" hallucination we observed on
//       Ubuntu: the LLM can pattern-match "test" + "publish" into a
//       command that does not exist, and the tool then emits a confusing
//       error. Rejecting here lets us produce a clear error AND retry
//       with a hint naming the offending command.
//
//   (b) Flags. Every --foo or -x token in args must appear in the skill
//       context's flag allowlist. Positional values (addresses, file
//       paths, key schemes) are deliberately NOT validated - the tool
//       itself is the authority on them.
//
// Leaf commands like just "--help" (no command path at all) are always
// allowed so the planner has a safe fallback.
export function validatePlan(plan: Plan, ctx: ToolContext): PlanValidation {
  // Extract the leading command tokens (stop at first flag).
  const cmdTokens: string[] = [];
  for (const a of plan.args) {
    if (a.startsWith('-')) break;
    cmdTokens.push(a);
  }
  const cmdPath = cmdTokens.join(' ');

  // Allow pure-flag plans (e.g. ["--version"] or ["--help"]).
  if (cmdTokens.length > 0 && ctx.allowedCommands.length > 0) {
    // Match rule: cmdPath must either equal an allowed command verbatim,
    // OR be a PREFIX of one (the LLM might emit just "client" with the
    // intent "client active-address"; the real subcommand then lives
    // further along as a positional argument which we can't validate -
    // but the prefix is still legal from the skill manifest's view).
    //
    // We also accept the REVERSE: cmdPath can be longer than an allowed
    // command IF the allowed command itself is a prefix of cmdPath.
    // This matters because the skill generator only probes 2 levels
    // deep, so "sui client object 0x..." has cmdTokens = ["client",
    // "object", "0x..."] while the manifest only knows "client object".
    // In that case "client object" is a prefix of our tokens -> allow.
    const cmdLower = cmdPath.toLowerCase();
    const hit = ctx.allowedCommands.some((allowed) => {
      const a = allowed.toLowerCase();
      if (a === cmdLower) return true;
      if (cmdLower.startsWith(a + ' ')) return true;
      if (a.startsWith(cmdLower + ' ')) return true;
      return false;
    });
    if (!hit) {
      // Surface up to 5 near matches for the retry hint. We use a simple
      // "shares first token" heuristic which is good enough since the
      // manifests are small (<100 commands per tool).
      const firstTok = cmdTokens[0].toLowerCase();
      const suggestions = ctx.allowedCommands
        .filter((c) => c.toLowerCase().startsWith(firstTok))
        .slice(0, 5);
      return { ok: false, kind: 'command', attempted: cmdPath, suggestions };
    }
  }

  const offending: string[] = [];
  for (const a of plan.args) {
    if (a.startsWith('--') || /^-[a-zA-Z]$/.test(a)) {
      if (!ctx.allowedFlags.has(a)) offending.push(a);
    }
  }
  if (offending.length) return { ok: false, kind: 'flag', offending };
  return { ok: true };
}

// Deterministic offline planner so the demo keeps working without network
// or an API key. Covers the acceptance-criteria prompts explicitly and
// falls back to `--help` so we never spawn something unexpected.
function mockPlan(prompt: string, tool: string): Plan {
  const p = prompt.toLowerCase();
  // Use toolFilename so the emitted binary string matches what the safety
  // gate + spawner expect on the current OS (sui on Unix, sui.exe on Win).
  const binary =
    tool === 'sui' ? toolFilename('sui')
    : tool === 'walrus' ? toolFilename('walrus')
    : toolFilename('site-builder');

  if (tool === 'sui') {
    // Move package workflow - must come BEFORE the generic "publish"
    // match so that "build contract" routes to `sui move build` and
    // not to the gas-spending `sui client publish`.
    if (/\b(build|compile|check)\b/.test(p) && !/\bpublish|deploy\b/.test(p))
      return { binary, args: ['move', 'build'] };
    if (/\b(test|tests|unit\s*test)\b/.test(p))
      return { binary, args: ['move', 'test'] };
    if (/\b(new\s+package|scaffold)\b/.test(p))
      return { binary, args: ['move', 'new'] };
    if (/\b(publish|deploy|ship|push)\b.*\b(contract|package|module|move)\b/.test(p))
      return { binary, args: ['client', 'publish'] };
    if (/active.?address/.test(p)) return { binary, args: ['client', 'active-address'] };
    if (/\baddresses?\b/.test(p)) return { binary, args: ['client', 'addresses'] };
    if (/\bgas\b/.test(p)) return { binary, args: ['client', 'gas'] };
    if (/\bswitch\b.*\btestnet\b/.test(p))
      return { binary, args: ['client', 'switch', '--env', 'testnet'] };
    if (/\bswitch\b.*\bdevnet\b/.test(p))
      return { binary, args: ['client', 'switch', '--env', 'devnet'] };
    if (/\bswitch\b.*\bmainnet\b/.test(p))
      return { binary, args: ['client', 'switch', '--env', 'mainnet'] };
    if (/version/.test(p)) return { binary, args: ['--version'] };
  }
  if (tool === 'walrus') {
    if (/info/.test(p)) return { binary, args: ['info'] };
    if (/list.?blobs?/.test(p)) return { binary, args: ['list-blobs'] };
    if (/\b(upload|store|put)\b/.test(p)) return { binary, args: ['store'] };
    if (/\b(download|read|fetch)\b/.test(p)) return { binary, args: ['read'] };
    if (/\bget.?wal\b/.test(p)) return { binary, args: ['get-wal'] };
  }
  if (tool === 'site-builder') {
    if (/sitemap/.test(p)) return { binary, args: ['sitemap'] };
    if (/\b(publish|deploy)\b/.test(p)) return { binary, args: ['publish'] };
  }
  return { binary, args: ['--help'] };
}

export async function planCommand(
  prompt: string,
  ctx: ToolContext,
): Promise<Plan> {
  // Mock mode: short-circuit the LLM round-trip. Perfect for offline demos.
  // Also auto-engaged when no key is configured (via `cmdo init` or env),
  // so a fresh install keeps working even before the user adds credentials.
  const { apiKey } = getEffectiveLLM();
  if (process.env.CMDO_LLM_MOCK === '1' || !apiKey) {
    const p = mockPlan(prompt, ctx.tool);
    log.debug('using mock planner:', p);
    return p;
  }

  const sys = SYSTEM_PROMPT(ctx.tool, ctx.section);
  const user = `User request: ${prompt}\nReturn only the JSON plan.`;

  let raw = await chat({
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    responseFormatJson: true,
  });

  let plan = tryParseJson(raw);
  if (!plan) {
    throw new PlannerError(
      'LLM did not return valid JSON',
      'Retry the prompt or set CMDO_LLM_MOCK=1 for a deterministic fallback.',
    );
  }

  let check = validatePlan(plan, ctx);
  if (!check.ok) {
    // Build a targeted retry message tailored to the failure kind. This
    // matters because a "bad command" retry needs to enumerate valid
    // alternatives, whereas a "bad flag" retry just needs the offending
    // flag names. Giving the LLM the right corrective pressure on the
    // first retry dramatically reduces wasted tokens.
    const retryUserMsg =
      check.kind === 'command'
        ? `Your previous plan used a command path "${check.attempted}" that is NOT in the skill context. ${
            check.suggestions.length
              ? `Closest valid commands: ${check.suggestions
                  .map((s) => `"${s}"`)
                  .join(', ')}. Pick one of these (or another that appears verbatim in the skill context) and regenerate the JSON plan.`
              : 'Pick a command that appears verbatim in the skill context and regenerate the JSON plan.'
          }`
        : `Your previous plan used flags that are NOT in the skill context: ${check.offending.join(
            ', ',
          )}. Regenerate the plan using ONLY flags explicitly listed in the skill context.`;

    log.warn(
      check.kind === 'command'
        ? `LLM emitted unknown command "${check.attempted}"; retrying with suggestions.`
        : `LLM emitted unknown flags: ${check.offending.join(', ')}; retrying with narrower context.`,
    );
    raw = await chat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
        { role: 'assistant', content: JSON.stringify(plan) },
        { role: 'user', content: retryUserMsg },
      ],
      responseFormatJson: true,
    });
    plan = tryParseJson(raw);
    if (!plan) {
      throw new PlannerError('LLM retry did not return valid JSON.');
    }
    check = validatePlan(plan, ctx);
    if (!check.ok) {
      const reason =
        check.kind === 'command'
          ? `LLM still used an unknown command after retry: "${check.attempted}"`
          : `LLM still used unknown flags after retry: ${check.offending.join(', ')}`;
      throw new PlannerError(
        reason,
        'Try rephrasing the prompt or run `cmdo update-skills` to refresh the skill manifest.',
      );
    }
  }

  return plan;
}
