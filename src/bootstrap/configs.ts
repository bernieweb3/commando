import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import axios from 'axios';
import { binaryPath } from './paths';
import { toolFilename } from './platform';
import { log } from '../utils/logger';

const pexec = promisify(execFile);

// Post-install config bootstrapping for the two CLIs that require external
// config files to do anything useful:
//
//   1. Walrus  - refuses to run without `client_config.yaml`. The
//      upstream CLI prints a terse "could not find a valid Walrus
//      configuration file" error with no hint about where to get one,
//      which is the single most common friction point for new users.
//      We fetch the canonical file straight from docs.wal.app (same URL
//      the official docs tell users to `curl`) and drop it into
//      ~/.config/walrus/client_config.yaml. Default context is already
//      "testnet" in the upstream file, which matches our demo target.
//
//   2. Sui client - the CLI itself auto-creates ~/.sui/sui_config/
//      client.yaml on first run, but only interactively (it prompts
//      "create one [Y/n]?"). That works fine when a human is at the
//      terminal but breaks any kind of scripted automation. We run the
//      same first-run now, piping "y\n" to stdin so the prompt is
//      answered non-interactively and the wallet is initialised before
//      the user sees it.
//
// Both steps are best-effort: a failure is logged and we move on. We
// never want config bootstrap to fail the install (users can re-run
// `cmdo bootstrap` later, and the binaries still work once their own
// configs are provided).

// The canonical URL recommended in the Walrus docs. Returns YAML text.
// If this endpoint is temporarily unavailable we fall back to the raw
// GitHub source so a blip in docs.wal.app doesn't break new installs.
const WALRUS_CONFIG_URL =
  'https://docs.wal.app/setup/client_config.yaml';
const WALRUS_CONFIG_FALLBACK_URL =
  'https://raw.githubusercontent.com/MystenLabs/walrus/main/setup/client_config.yaml';

function walrusConfigPath(): string {
  // Match the first "standard" location Walrus checks so the CLI finds
  // it without needing --config flag. On Linux/macOS this is the XDG
  // default; on Windows it still works because walrus resolves the
  // same ~/.config/walrus directory regardless of OS.
  return path.join(os.homedir(), '.config', 'walrus', 'client_config.yaml');
}

async function fetchWalrusConfig(): Promise<string> {
  const urls = [WALRUS_CONFIG_URL, WALRUS_CONFIG_FALLBACK_URL];
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await axios.get(url, {
        responseType: 'text',
        timeout: 30_000,
        maxRedirects: 10,
        // Let the caller inspect non-2xx rather than auto-throw with a
        // generic message. We want to try the fallback on 4xx/5xx too.
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300 && typeof res.data === 'string') {
        return res.data;
      }
      lastErr = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('all walrus config URLs failed');
}

// Publicly exported so a future `cmdo setup-walrus` subcommand can
// reuse the same logic. Returns true when the config ended up on disk
// (already existed OR we successfully wrote it), false on failure.
export async function ensureWalrusConfig(): Promise<boolean> {
  const target = walrusConfigPath();
  if (fs.existsSync(target)) {
    log.info(`walrus config already present at ${target}`);
    return true;
  }
  try {
    log.info('fetching walrus client config from docs.wal.app...');
    const body = await fetchWalrusConfig();
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, body, 'utf8');
    log.success(`wrote walrus config to ${target} (default context: testnet)`);
    return true;
  } catch (err) {
    log.warn(
      `could not fetch walrus config: ${(err as Error).message}.`,
    );
    log.info(
      'hint: you can install it manually later with:\n' +
        `  curl --create-dirs ${WALRUS_CONFIG_URL} -o ${target}`,
    );
    return false;
  }
}

function suiWalletPath(): string {
  return path.join(os.homedir(), '.sui', 'sui_config', 'client.yaml');
}

// Trigger sui's own interactive first-run by piping "y\n" to stdin, so
// the sui CLI creates its default wallet config + keystore + keypair
// without bothering the user. We call `sui client active-address` as a
// cheap command that unconditionally needs the config, which means sui
// will run its setup wizard if client.yaml is missing.
export async function ensureSuiWallet(): Promise<boolean> {
  const target = suiWalletPath();
  if (fs.existsSync(target)) {
    log.info(`sui wallet config already present at ${target}`);
    return true;
  }

  const sui = binaryPath(toolFilename('sui'));
  if (!fs.existsSync(sui)) {
    // Binary not installed yet (e.g. CMDO_SKIP_BOOTSTRAP=1 earlier).
    // Nothing to do; let a future bootstrap pass handle it.
    log.debug('sui binary not found; skipping wallet init.');
    return false;
  }

  try {
    log.info('initialising default sui wallet (auto-answering prompts)...');
    // Using pexec so we can pipe stdin. sui prompts:
    //   1. "No sui config found ..., create one [Y/n]?"   -> y
    //   2. "Sui Full node server URL (Defaults to Sui Testnet ...):" -> empty line (use default)
    //   3. "Select key scheme..." -> 0 (ed25519)
    // Sending "y\n\n0\n" covers all three. Extra newlines are harmless
    // because sui stops reading stdin after the wizard completes.
    await pexec(sui, ['client', 'active-address'], {
      timeout: 30_000,
      windowsHide: true,
      // execFile doesn't expose stdin directly; we use spawn below
      // instead so we can pipe the canned answers.
      // (See implementation trick immediately below.)
    }).catch(() => {
      // Swallow: we'll retry via spawn with stdin piped.
    });

    // If the first attempt (no stdin) was enough (rare - only when sui
    // somehow already had state it could recover), we're done.
    if (fs.existsSync(target)) {
      log.success(`sui wallet initialised at ${target}`);
      return true;
    }

    // Fallback: use spawn to pipe stdin answers. This is the real path
    // for a fresh install.
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve) => {
      const child = spawn(sui, ['client', 'active-address'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      // Pipe the three canned answers. The exact prompt set differs
      // slightly between sui minor versions, but every version accepts
      // "y" for the confirmation and an empty line for URL defaults.
      child.stdin.write('y\n\n0\n');
      child.stdin.end();
      child.on('close', () => resolve());
      child.on('error', () => resolve());
      // Hard stop in case sui prompts for something unexpected.
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve();
      }, 20_000);
    });

    if (fs.existsSync(target)) {
      log.success(`sui wallet initialised at ${target}`);
      return true;
    }
    log.warn(
      'sui wallet init did not produce a config; run `sui client` manually to finish setup.',
    );
    return false;
  } catch (err) {
    log.warn(`sui wallet init failed: ${(err as Error).message}`);
    return false;
  }
}

// Orchestrator called from postinstall after binaries are on disk.
export async function bootstrapConfigs(): Promise<void> {
  // Sui wallet first because walrus's default config references the
  // sui client config path. If the sui wallet does not exist when
  // walrus starts, walrus prints a separate confusing error.
  await ensureSuiWallet();
  await ensureWalrusConfig();
}
