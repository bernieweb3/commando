import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PATHS } from '../bootstrap/paths';
import { loadManifest } from '../bootstrap/download';
import { expectedBinariesForPlatform } from '../bootstrap/download-gh';
import { platform } from '../bootstrap/platform';
import { sha256File } from '../utils/hash';
import { log } from '../utils/logger';
import { getEffectiveLLM } from '../config/userConfig';
import { isR2Configured } from '../config/defaults';

// Some Mysten Labs Windows binaries (observed with walrus 1.45.x) crash
// with STATUS_ILLEGAL_INSTRUCTION (exit code -1073741795 / 0xC000001D)
// on pre-Skylake Intel CPUs. The upstream release is built assuming
// Skylake-era SIMD, so there is nothing Commando can fix; the best we
// can do is warn the user up front instead of letting them chase a
// mystery crash. Match on the marketing-name tokens we know are
// affected: Haswell (4xxx), Broadwell (5xxx), Ivy Bridge (3xxx).
const UNSUPPORTED_CPU_RE = /\bi[357]-(?:3|4|5)\d{3}[A-Z]*\b/i;

function checkCpuCompatibility(): void {
  const cpus = os.cpus();
  if (!cpus.length) return;
  const model = cpus[0].model || '';
  log.info(`cpu: ${model}`);
  if (UNSUPPORTED_CPU_RE.test(model)) {
    log.warn(
      'this CPU pre-dates Skylake; some upstream binaries (notably walrus) are known to crash here with STATUS_ILLEGAL_INSTRUCTION.',
    );
    log.warn(
      '   -> sui / site-builder commands should still work; run walrus commands on a newer machine if they crash.',
    );
  }
}

// Environment diagnostics. Prints a tidy checklist so the judges can see at
// a glance whether Commando is wired up correctly on this machine.
export async function doctorCmd(): Promise<number> {
  let ok = true;
  const plat = platform();

  const nodeVer = process.versions.node;
  log.info(`node: v${nodeVer}`);
  if (parseInt(nodeVer.split('.')[0], 10) < 20) {
    log.warn('Node 20+ recommended.');
  }

  log.info(`platform: ${plat.key}`);

  checkCpuCompatibility();

  log.info(`install root: ${PATHS.root}`);
  log.info(`bin dir: ${PATHS.bin} ${fs.existsSync(PATHS.bin) ? '[ok]' : '[missing]'}`);
  log.info(`skills file: ${PATHS.agentMd} ${fs.existsSync(PATHS.agentMd) ? '[ok]' : '[missing]'}`);

  // PATH membership check - use the correct delimiter per platform.
  const envPath = process.env.PATH || process.env.Path || '';
  const onPath = envPath.split(path.delimiter).some(
    (p) => p.trim().toLowerCase() === PATHS.bin.toLowerCase(),
  );
  log.info(`bin on PATH: ${onPath ? 'yes' : 'NO (open a new shell or run bootstrap again)'}`);
  if (!onPath) ok = false;

  // Per-binary status. Two verification modes:
  //   - SHA256 against R2 manifest: only when the operator has configured
  //     the R2 path (CMDO_MANIFEST_URL + CMDO_R2_TOKEN). This is Windows-only
  //     and gated; the manifest has never existed for Linux/macOS.
  //   - File-presence + executable bit: the default everywhere else.
  if (plat.os === 'windows' && isR2Configured()) {
    try {
      const manifest = await loadManifest();
      for (const entry of manifest.binaries) {
        const name = path.basename(entry.installPath);
        const full = path.join(PATHS.bin, name);
        if (!fs.existsSync(full)) {
          log.warn(`missing: ${name}`);
          ok = false;
          continue;
        }
        const hash = await sha256File(full);
        const match = hash.toLowerCase() === entry.sha256.toLowerCase();
        log.info(`${name}: ${match ? 'sha256 ok' : 'sha256 MISMATCH'}`);
        if (!match) ok = false;
      }
    } catch (err) {
      log.warn('could not read manifest:', (err as Error).message);
      ok = false;
    }
  } else {
    const expected = expectedBinariesForPlatform();
    for (const name of expected) {
      const full = path.join(PATHS.bin, name);
      if (!fs.existsSync(full)) {
        log.warn(`missing: ${name}`);
        ok = false;
        continue;
      }
      // Check executable bit; without it `spawn` fails with EACCES.
      try {
        fs.accessSync(full, fs.constants.X_OK);
        log.info(`${name}: present (+x)`);
      } catch {
        log.warn(`${name}: present but NOT executable (chmod +x needed)`);
        ok = false;
      }
    }
  }

  const { provider, apiKey, model } = getEffectiveLLM();
  const providerLabel = provider === 'openai' ? 'OpenAI' : 'OpenRouter';
  const envHint =
    provider === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
  log.info(
    `LLM provider: ${providerLabel} (model=${model}) - ${apiKey ? 'key configured' : `no key (run \`cmdo init\` or set ${envHint})`}`,
  );
  log.info(`CMDO_LLM_MOCK: ${process.env.CMDO_LLM_MOCK || '0'}`);

  if (ok) log.success('doctor: all checks passed.');
  else log.warn('doctor: some checks failed - see above.');
  return ok ? 0 : 1;
}
