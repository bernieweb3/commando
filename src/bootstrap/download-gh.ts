import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import axios from 'axios';
import { log } from '../utils/logger';
import { BootstrapError } from '../utils/errors';
import { platform, TargetPlatform } from './platform';

// GitHub-direct installer for Linux and macOS (and also usable on Windows,
// though the Windows flow keeps using the R2 manifest + SHA256 path).
//
// Why a separate module? The R2 flow in download.ts is tuned for a single
// pre-built manifest (flat .exe files, SHA256 verification, range-resume).
// GitHub releases ship .tgz archives that must be extracted, contain many
// binaries per archive, and do not publish per-asset hashes in a
// machine-readable manifest. Trying to shoehorn both into one function
// produced a lot of `if (tar) ... else ...` branches; splitting by flow is
// clearer for reviewers and easier to delete once upstream standardises.

type DownloadSpec = {
  // Logical name used only for log output.
  tool: 'sui' | 'walrus' | 'site-builder';
  // Map from platform.key -> tarball URL. A missing key means "skip on this
  // platform" (e.g. site-builder has no Ubuntu aarch64 build upstream).
  urls: Partial<Record<string, string>>;
};

// Hardcoded mapping of tool -> per-platform tarball URL. Versions are pinned
// so installs stay reproducible. Bump here + rebuild to ship new releases.
const GITHUB_DOWNLOADS: DownloadSpec[] = [
  {
    tool: 'sui',
    urls: {
      'windows-x86_64':
        'https://github.com/MystenLabs/sui/releases/download/testnet-v1.70.1/sui-testnet-v1.70.1-windows-x86_64.tgz',
      'linux-x86_64':
        'https://github.com/MystenLabs/sui/releases/download/testnet-v1.70.1/sui-testnet-v1.70.1-ubuntu-x86_64.tgz',
      'linux-aarch64':
        'https://github.com/MystenLabs/sui/releases/download/testnet-v1.70.1/sui-testnet-v1.70.1-ubuntu-aarch64.tgz',
      'macos-x86_64':
        'https://github.com/MystenLabs/sui/releases/download/testnet-v1.70.1/sui-testnet-v1.70.1-macos-x86_64.tgz',
      'macos-arm64':
        'https://github.com/MystenLabs/sui/releases/download/testnet-v1.70.1/sui-testnet-v1.70.1-macos-arm64.tgz',
    },
  },
  {
    tool: 'walrus',
    urls: {
      'windows-x86_64':
        'https://github.com/MystenLabs/walrus/releases/download/testnet-v1.46.1/walrus-testnet-v1.46.1-windows-x86_64.tgz',
      'linux-x86_64':
        'https://github.com/MystenLabs/walrus/releases/download/testnet-v1.46.1/walrus-testnet-v1.46.1-ubuntu-x86_64.tgz',
      'linux-aarch64':
        'https://github.com/MystenLabs/walrus/releases/download/testnet-v1.46.1/walrus-testnet-v1.46.1-ubuntu-aarch64.tgz',
      'macos-x86_64':
        'https://github.com/MystenLabs/walrus/releases/download/testnet-v1.46.1/walrus-testnet-v1.46.1-macos-x86_64.tgz',
      'macos-arm64':
        'https://github.com/MystenLabs/walrus/releases/download/testnet-v1.46.1/walrus-testnet-v1.46.1-macos-arm64.tgz',
    },
  },
  {
    tool: 'site-builder',
    urls: {
      'windows-x86_64':
        'https://github.com/MystenLabs/walrus-sites/releases/download/mainnet-v2.8.0/site-builder-mainnet-v2.8.0-windows-x86_64.tgz',
      'linux-x86_64':
        'https://github.com/MystenLabs/walrus-sites/releases/download/mainnet-v2.8.0/site-builder-mainnet-v2.8.0-ubuntu-x86_64.tgz',
      // No upstream ubuntu-aarch64 build; per product decision we skip the
      // tool (not error) on Linux ARM. Users can still run sui + walrus.
      'macos-x86_64':
        'https://github.com/MystenLabs/walrus-sites/releases/download/mainnet-v2.8.0/site-builder-mainnet-v2.8.0-macos-x86_64.tgz',
      'macos-arm64':
        'https://github.com/MystenLabs/walrus-sites/releases/download/mainnet-v2.8.0/site-builder-mainnet-v2.8.0-macos-arm64.tgz',
    },
  },
];

// Knobs mirror the R2 downloader for consistency.
const IDLE_MS = Number(process.env.CMDO_DOWNLOAD_IDLE_MS) || 120_000;
const MAX_RETRIES = Number(process.env.CMDO_DOWNLOAD_RETRIES) || 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Stream a URL to disk with an idle watchdog + size log line. We do NOT
// do Range/resume here because the tarballs are small-ish (<200MB total per
// archive) and GitHub's CDN is fast enough that a simple re-download on
// failure is cheaper than keeping resume state straight across restarts.
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await axios.get(url, {
    responseType: 'stream',
    maxRedirects: 10, // GitHub redirects releases -> objects.githubusercontent.com
    timeout: 30_000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const writer = fs.createWriteStream(destPath);
  await new Promise<void>((resolve, reject) => {
    let idleTimer: NodeJS.Timeout;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      if (err) {
        response.data.destroy();
        writer.destroy();
        reject(err);
      } else {
        resolve();
      }
    };
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => finish(new Error(`idle timeout (${IDLE_MS}ms)`)),
        IDLE_MS,
      );
    };

    resetIdle();
    response.data.on('data', resetIdle);
    response.data.on('error', finish);
    writer.on('error', finish);
    writer.on('finish', () => finish());
    response.data.pipe(writer);
  });
}

// Extract a .tgz into destDir using the system `tar` command. `tar` exists
// on every supported target (macOS, Linux, and Windows 10+ ship it), which
// lets us avoid a native Node dependency. We stream stderr to our logger so
// archive errors surface immediately instead of hiding behind exit codes.
function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
    });
  });
}

// Recursively walk a directory and return every file path.
async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Heuristic: an entry is a "binary we want" if the filename (without .exe)
// has no dot, no dash-prefixed extensions (.1, .md, .txt), and is executable
// by the target OS. Mysten tarballs contain bare ELF/PE/Mach-O binaries at
// the top level, plus occasional doc/readme files we skip.
function isLikelyBinary(name: string, targetOS: TargetPlatform['os']): boolean {
  const lower = name.toLowerCase();
  if (targetOS === 'windows') {
    return lower.endsWith('.exe');
  }
  // Unix: reject obvious non-binaries by extension.
  if (/\.(md|txt|json|yaml|yml|toml|html|pdf|sig|sha256|asc|1)$/i.test(lower)) {
    return false;
  }
  // Reject dotfiles and archive leftovers.
  if (lower.startsWith('.')) return false;
  return true;
}

// Download + extract ONE tarball into `binDir`. Strategy:
//   1. download tgz into a temp dir
//   2. `tar -xzf tgz -C tmp-extract`
//   3. walk tmp-extract, copy every executable-looking file into binDir
//   4. chmod +x on Unix
//   5. clean up temp dir
async function downloadAndExtract(
  spec: DownloadSpec,
  url: string,
  binDir: string,
  plat: TargetPlatform,
): Promise<void> {
  const tmpRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), `cmdo-${spec.tool}-`),
  );
  const tgzPath = path.join(tmpRoot, 'archive.tgz');
  const extractDir = path.join(tmpRoot, 'extract');
  await fsp.mkdir(extractDir, { recursive: true });

  try {
    log.info(`downloading ${spec.tool} (${url.split('/').pop()})`);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await downloadToFile(url, tgzPath);
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        const remaining = MAX_RETRIES - attempt;
        if (remaining <= 0) break;
        const delay = attempt === 1 ? 2_000 : attempt === 2 ? 5_000 : 10_000;
        log.warn(
          `download of ${spec.tool} failed (attempt ${attempt}/${MAX_RETRIES}): ${(err as Error).message}. retrying in ${delay / 1000}s...`,
        );
        await sleep(delay);
      }
    }
    if (lastErr) {
      throw new BootstrapError(
        `Network error fetching ${spec.tool} after ${MAX_RETRIES} attempts`,
        'Check your internet connection and retry `cmdo bootstrap`.',
        lastErr,
      );
    }

    log.info(`extracting ${spec.tool}...`);
    await runTar(['-xzf', tgzPath, '-C', extractDir]);

    // Walk the extracted tree and copy every plausible binary to binDir.
    // We flatten the layout so every binary ends up at a predictable
    // location Commando already expects (~/.commando/bin/<name>).
    const files = await walkFiles(extractDir);
    const installed: string[] = [];
    for (const file of files) {
      const name = path.basename(file);
      if (!isLikelyBinary(name, plat.os)) continue;
      const dest = path.join(binDir, name);
      await fsp.copyFile(file, dest);
      if (plat.os !== 'windows') {
        // 0o755 = rwxr-xr-x. Extracted files often come in as 0o644, which
        // renders them non-executable - the user would get "permission denied"
        // without this.
        await fsp.chmod(dest, 0o755);
      }
      installed.push(name);
    }

    if (!installed.length) {
      throw new BootstrapError(
        `extracted ${spec.tool} archive contained no binaries`,
        `archive: ${url}`,
      );
    }

    log.success(
      `installed ${spec.tool}: ${installed.join(', ')}`,
    );
  } finally {
    // Best-effort cleanup; we don't want a cleanup failure to mask a real
    // download/extract error from the caller.
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// Public entrypoint for the GitHub-direct flow. Mirrors the public shape
// of downloadAll() in download.ts so postinstall.ts can swap between them
// based on platform with a single if/else.
export async function downloadAllFromGitHub(binDir: string): Promise<void> {
  const plat = platform();
  await fsp.mkdir(binDir, { recursive: true });

  log.info(
    `github-direct install for ${plat.key} (concurrency=1, retries=${MAX_RETRIES})`,
  );

  for (const spec of GITHUB_DOWNLOADS) {
    const url = spec.urls[plat.key];
    if (!url) {
      // site-builder on linux-aarch64 hits this branch today. Per the
      // product decision we skip silently instead of erroring, so the other
      // tools still install on ARM Linux machines.
      log.warn(
        `no upstream build of ${spec.tool} for ${plat.key}; skipping.`,
      );
      continue;
    }
    await downloadAndExtract(spec, url, binDir, plat);
  }
}

// Exposed for `cmdo doctor`: returns the list of binary BASENAMES we expect
// to exist in bin/ after a successful install. This is used for presence
// checks on Unix where we don't have a manifest with SHA256.
export function expectedBinariesForPlatform(): string[] {
  const plat = platform();
  const suffix = plat.exeSuffix;
  // The user-facing tools we always expect (subject to the skip rule).
  const names: string[] = [];
  for (const spec of GITHUB_DOWNLOADS) {
    if (!spec.urls[plat.key]) continue;
    names.push(`${spec.tool}${suffix}`);
  }
  return names;
}
