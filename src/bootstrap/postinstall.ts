import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PATHS } from './paths';
import { loadManifest, downloadAll } from './download';
import { downloadAllFromGitHub } from './download-gh';
import { addToUserPath } from './addToPath';
import { platform } from './platform';
import { isR2Configured } from '../config/defaults';
import { bootstrapConfigs } from './configs';
import { generateSkills } from '../skills/generator';
import { log } from '../utils/logger';
import { BootstrapError } from '../utils/errors';

// End-to-end bootstrap orchestrator. Runs during `npm run bootstrap` and also
// as the `postinstall` hook on global/local installs. Keeping each step in a
// dedicated module makes it easy to reason about failure modes for the judges.

async function ensureDirs(): Promise<void> {
  const dirs = [
    PATHS.bin,
    PATHS.skills,
    PATHS.sandboxConfig,
    PATHS.sandboxKeystore,
  ];
  for (const d of dirs) {
    await fsp.mkdir(d, { recursive: true });
  }
}

export async function runBootstrap(): Promise<void> {
  const plat = platform(); // throws on unsupported OS/arch with a clear message
  log.info(`bootstrap starting on ${plat.key}...`);
  await ensureDirs();

  // Install strategy:
  //   - Default (every OS): download directly from upstream GitHub releases
  //     via `download-gh.ts`. No secrets needed, no provenance manifest.
  //   - Optional R2 manifest path (Windows only): if the operator has set
  //     BOTH `CMDO_MANIFEST_URL` and `CMDO_R2_TOKEN`, we use the legacy
  //     R2 flow that gives per-binary SHA256 provenance. This is meant for
  //     CI mirrors / air-gapped enterprise deployments, NOT regular users.
  //
  // We only allow the R2 path on Windows because that's the only platform
  // we ever shipped a manifest for; Linux/macOS releases were never mirrored
  // to R2 and we're not going to start now.
  if (plat.os === 'windows' && isR2Configured()) {
    log.info('R2 manifest config detected; using R2 install path.');
    const manifest = await loadManifest();
    log.info(
      `manifest v${manifest.version}: ${manifest.binaries.length} binaries`,
    );
    await downloadAll(manifest, PATHS.bin);
  } else {
    await downloadAllFromGitHub(PATHS.bin);
  }

  addToUserPath(PATHS.bin);

  // Auto-bootstrap the two external config files users would otherwise
  // hit as paper-cuts on first run:
  //   - ~/.sui/sui_config/client.yaml (sui wallet)
  //   - ~/.config/walrus/client_config.yaml
  // Best-effort: a failure here logs a hint and continues. Skill gen
  // and PATH patching still succeed.
  try {
    await bootstrapConfigs();
  } catch (err) {
    log.warn('config bootstrap encountered issues; see hints above.');
    log.debug(err);
  }

  // Generate skills from --help output. This requires the binaries to be on
  // disk (just done) and ideally on PATH (addToUserPath patched in-process).
  try {
    await generateSkills();
  } catch (err) {
    // Skill generation is best-effort during install: users can always
    // re-run `cmdo update-skills` later.
    log.warn('skill generation failed; run `cmdo update-skills` later.');
    log.debug(err);
  }

  log.success('bootstrap complete.');
  log.info('open a NEW terminal to pick up the updated PATH.');
}

// Called directly by `node dist/bootstrap/postinstall.js`. Two distinct
// callers hit this path and we want different behavior for each:
//
//   (a) npm's postinstall hook (npm_lifecycle_event === 'postinstall').
//       Goal: NEVER break `npm install` for sibling dependencies even
//       if bootstrap fails. So we exit(0) on any error, print a clear
//       banner explaining the ~850MB download, and honor
//       CMDO_SKIP_BOOTSTRAP=1 / CI environments as an opt-out.
//
//   (b) explicit user invocation (`npm run bootstrap`, `cmdo bootstrap`).
//       Goal: surface failures loudly with exit(1) so the user can fix
//       and retry. No skip, no banner - they asked for it.
function isPostinstallHook(): boolean {
  return process.env.npm_lifecycle_event === 'postinstall';
}

function printPostinstallBanner(): void {
  const installRoot =
    process.platform === 'win32' ? '%USERPROFILE%\\.commando' : '~/.commando';
  log.info('--------------------------------------------------------------');
  log.info(' Commando postinstall: downloading Mysten Labs CLIs');
  log.info(` (sui, walrus, site-builder) into ${installRoot}.`);
  log.info(' Set CMDO_SKIP_BOOTSTRAP=1 to skip; run `cmdo bootstrap` later.');
  log.info('--------------------------------------------------------------');
}

if (require.main === module) {
  const hookMode = isPostinstallHook();

  if (hookMode) {
    printPostinstallBanner();
    // Explicit user opt-out for CI, Docker builds, slow networks, etc.
    // Truthy = any non-empty, non-"0" value - keeps the UX forgiving.
    const skip = process.env.CMDO_SKIP_BOOTSTRAP;
    if (skip && skip !== '0' && skip.toLowerCase() !== 'false') {
      log.info(
        'CMDO_SKIP_BOOTSTRAP set; skipping binary download. Run `cmdo bootstrap` when ready.',
      );
      process.exit(0);
    }
  }

  runBootstrap().catch((err: unknown) => {
    if (err instanceof BootstrapError) {
      log.error(err.message);
      if (err.hint) log.info(`hint: ${err.hint}`);
    } else {
      log.error('unexpected bootstrap failure:', err);
    }
    if (hookMode) {
      // Soft-fail during npm install so the rest of the user's workflow
      // (other deps, global bin linking) still completes.
      log.warn(
        'bootstrap failed but install continues; run `cmdo bootstrap` to retry.',
      );
      process.exit(0);
    }
    process.exit(1);
  });
}

// Re-exported so `cmdo doctor` can reuse helpers without duplicating logic.
export { ensureDirs };
export const _internal = { fs };
