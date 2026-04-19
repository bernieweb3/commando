import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../bootstrap/paths';
import { Plan } from '../llm/planner';
import { toolFilename, TOOL_BASENAMES, ToolBase } from '../bootstrap/platform';

// Defense in depth. Even if the router + LLM layers misbehave, the safety
// gate is the last stop before we hand control to a native binary. The
// checks here are intentionally narrow and conservative:
//   1. Binary allowlist  - must resolve inside ~/.commando/bin.
//   2. Denylist patterns - obvious destructive intent in prompt or argv.
//   3. Path-traversal    - no args may contain ".." segments.

// Argv-only denylist: applied to each argv element emitted by the planner.
// Kept narrow because legitimate file-path args can look scary (e.g. paths
// starting with a drive letter when --path is required).
const ARG_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /(^|[\s;&|])(del|rmdir|rd|format|shutdown|reg\s+delete)\b/i, label: 'destructive-windows-command' },
  // Unix-side counterparts. Matters now that we support Linux/macOS -
  // a malicious prompt could otherwise smuggle "shutdown -h now" or
  // "dd if=/dev/zero of=/dev/sda" through the planner.
  { re: /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/i, label: 'destructive-unix-command' },
  { re: /\bdd\s+if=/i, label: 'dd-write' },
  { re: /\bmkfs(\.|\b)/i, label: 'mkfs' },
  { re: /\brm\s+-rf\b/i, label: 'rm-rf' },
  { re: /\.\.[\\/]/, label: 'path-traversal' },
  { re: /^[A-Z]:\\?$/i, label: 'bare-drive-root' },
];

// Prompt-level denylist: applied to the raw natural-language input. We
// include full English verbs here because users don't type "del", they type
// "delete". We deliberately match substrings for dangerous verbs because
// paraphrasing ("wipe", "erase", ...) is cheap for an attacker.
const PROMPT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(delete|erase|wipe|destroy|format)\b.*\b(drive|disk|everything|all|home|system|c:|\/|root|etc|bin|usr)\b/i, label: 'destructive-intent' },
  { re: /\b(del|rmdir|rd|format|shutdown)\b/i, label: 'destructive-windows-command' },
  { re: /\b(reboot|halt|poweroff)\b/i, label: 'destructive-unix-command' },
  { re: /\brm\s+-rf\b/i, label: 'rm-rf' },
  { re: /\bc:\\/i, label: 'absolute-drive-path' },
  { re: /\.\.[\\/]/, label: 'path-traversal' },
];

export interface SafetyResult {
  ok: boolean;
  reason?: string;
  hint?: string;
  resolvedBinary?: string;
}

// Scan a prompt *before* we spend tokens on it. Blocks obvious destructive
// intent so we never even reach the LLM / exec path.
export function screenPrompt(prompt: string): SafetyResult {
  for (const p of PROMPT_PATTERNS) {
    if (p.re.test(prompt)) {
      return {
        ok: false,
        reason: `Prompt matched unsafe pattern: ${p.label}`,
        hint: 'Commando refuses to generate destructive local commands. Rephrase without system-modifying intent.',
      };
    }
  }
  return { ok: true };
}

// Validate the LLM-produced plan right before spawning.
export function screenPlan(plan: Plan): SafetyResult {
  // 1. Binary must resolve inside the flat bin directory.
  const base = path.basename(plan.binary);
  if (base !== plan.binary) {
    const examples = TOOL_BASENAMES.map(
      (b) => `"${toolFilename(b as ToolBase)}"`,
    ).join(' / ');
    return {
      ok: false,
      reason: `Binary must be a bare filename, got "${plan.binary}"`,
      hint: `Planner should emit just ${examples}.`,
    };
  }
  const resolved = path.join(PATHS.bin, base);
  const resolvedNorm = path.resolve(resolved).toLowerCase();
  const binNorm = path.resolve(PATHS.bin).toLowerCase();
  if (!resolvedNorm.startsWith(binNorm + path.sep) && resolvedNorm !== binNorm) {
    return {
      ok: false,
      reason: 'Binary path escapes the Commando bin directory.',
    };
  }
  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      reason: `Binary not installed: ${base}`,
      hint: 'Run `npm run bootstrap` to download missing binaries.',
    };
  }

  // 2. Arg screening: each argv element is checked against the denylist.
  //    We skip this for flags that look like `--foo=bar` because "C:\" can
  //    legitimately appear in a file-path value (e.g. --path C:\repo\move).
  //    Instead, we only reject backslash drive paths that look like the
  //    literal system-root or user-supplied "C:\" without subdirectories.
  for (const a of plan.args) {
    for (const p of ARG_PATTERNS) {
      if (p.re.test(a)) {
        return {
          ok: false,
          reason: `Argument matched unsafe pattern (${p.label}): ${a}`,
        };
      }
    }
  }

  return { ok: true, resolvedBinary: resolved };
}
