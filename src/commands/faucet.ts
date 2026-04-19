import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import axios from 'axios';
import { binaryPath } from '../bootstrap/paths';
import { toolFilename } from '../bootstrap/platform';
import { log } from '../utils/logger';
import { runBinary } from '../exec/spawner';

// Custom faucet handler. The Sui CLI's built-in `sui client faucet` works,
// but on testnet specifically it routes through an internal endpoint that
// has been rate-limited / unreliable for users. The official public faucet
// at https://faucet.testnet.sui.io/gas works without auth and is what the
// Sui docs recommend for testnet, so we call it directly.
//
// devnet and localnet still go through the CLI - their faucets live behind
// different URLs (devnet) or run inside the local validator (localnet) and
// the CLI already handles both correctly.

const pexec = promisify(execFile);

const TESTNET_FAUCET_URL = 'https://faucet.testnet.sui.io/gas';

// Faucet intent matcher. We want to catch imperative phrasings like
//   "faucet me", "drip 1 sui", "request sui from faucet",
//   "give me some test sui", "airdrop"
// but NOT informational phrasings like
//   "what is faucet?", "how does the faucet work?".
//
// Strategy: bail early on question-shaped prompts, then accept either
// an imperative request verb (request/give/drip/...) or the noun
// "faucet" followed by an action (faucet me / hit the faucet / from
// faucet).
const QUESTION_RE = /^\s*(what|why|how|when|where|who|does|do|is|are|can|could)\b|\?\s*$/i;

const REQUEST_VERB_RE =
  /\b(request|drip|airdrop|gimme|send\s+me|give\s+me|get\s+me|fund\s+me)\b[^.?!]*\b(sui|gas|tokens?|coins?)\b/i;

const FAUCET_NOUN_ACTION_RE =
  /\b(use\s+(?:the\s+)?faucet|hit\s+(?:the\s+)?faucet|faucet\s+me|from\s+(?:the\s+)?faucet|via\s+faucet)\b/i;

// Explicit env override in the prompt: "faucet on devnet", "drip me sui
// from testnet". Falls back to whatever `sui client active-env` returns.
const ENV_HINT_RE = /\b(testnet|devnet|localnet|mainnet)\b/i;

export function isFaucetIntent(prompt: string): boolean {
  if (QUESTION_RE.test(prompt)) return false;
  return REQUEST_VERB_RE.test(prompt) || FAUCET_NOUN_ACTION_RE.test(prompt);
}

interface SuiContext {
  address: string;
  env: string;
}

async function readSuiContext(prompt: string): Promise<SuiContext> {
  // Resolve the sui binary path with the platform-correct filename
  // (sui.exe on Windows, sui on Linux/macOS). Hardcoding .exe here was
  // the bug that made testnet faucet crash with ENOENT on Ubuntu.
  const sui = binaryPath(toolFilename('sui'));

  // active address - bare command, no flags needed.
  const addrRes = await pexec(sui, ['client', 'active-address'], {
    timeout: 10_000,
    windowsHide: true,
  });
  const address = addrRes.stdout.trim().split(/\r?\n/).pop()?.trim() || '';
  if (!/^0x[0-9a-fA-F]+$/.test(address)) {
    throw new Error(
      `could not read active address from sui CLI; got: ${JSON.stringify(address)}`,
    );
  }

  // Prompt override beats CLI state, so users can ask for "faucet on
  // devnet" without first running `sui client switch --env devnet`.
  const hint = prompt.match(ENV_HINT_RE);
  if (hint) {
    return { address, env: hint[1].toLowerCase() };
  }

  const envRes = await pexec(sui, ['client', 'active-env'], {
    timeout: 10_000,
    windowsHide: true,
  });
  const env = envRes.stdout.trim().split(/\r?\n/).pop()?.trim().toLowerCase();
  if (!env) throw new Error('could not read active env from sui CLI.');
  return { address, env };
}

async function postTestnetFaucet(address: string): Promise<unknown> {
  const res = await axios.post(
    TESTNET_FAUCET_URL,
    { FixedAmountRequest: { recipient: address } },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000,
      // Keep non-2xx out of the catch path so we can surface the API's
      // own error message (often a JSON body explaining the rate limit).
      validateStatus: () => true,
    },
  );
  if (res.status < 200 || res.status >= 300) {
    const body =
      typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    throw new Error(`HTTP ${res.status} - ${body.slice(0, 400)}`);
  }
  return res.data;
}

// Public entrypoint used by run.ts when the prompt triggers faucet intent.
// Returns a process-style exit code so the caller can propagate it.
export async function handleFaucet(prompt: string): Promise<number> {
  let ctx: SuiContext;
  try {
    ctx = await readSuiContext(prompt);
  } catch (err) {
    log.error('faucet: could not read sui context:', (err as Error).message);
    log.info('hint: ensure `sui client active-address` works first.');
    return 4;
  }

  log.info(
    `faucet: target=${ctx.address} env=${ctx.env}`,
  );

  if (ctx.env === 'mainnet') {
    log.error('faucet is not available on mainnet.');
    return 2;
  }

  if (ctx.env === 'testnet') {
    log.info(`faucet: POST ${TESTNET_FAUCET_URL}`);
    try {
      const data = await postTestnetFaucet(ctx.address);
      log.success('faucet: request accepted.');
      console.log(JSON.stringify(data, null, 2));
      return 0;
    } catch (err) {
      log.error('faucet: request failed:', (err as Error).message);
      log.info(
        'hint: testnet faucet is rate-limited per IP/address; wait a minute and retry, or switch to devnet.',
      );
      return 4;
    }
  }

  // devnet / localnet -> delegate to the Sui CLI which already knows the
  // right endpoint for each. We invoke it explicitly here (no LLM round
  // trip) because we already have a clear, deterministic intent.
  log.info(`faucet: delegating to sui CLI (env=${ctx.env}).`);
  return runBinary(binaryPath(toolFilename('sui')), ['client', 'faucet']);
}
