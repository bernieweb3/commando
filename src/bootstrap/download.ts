import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sha256File } from '../utils/hash';
import { log } from '../utils/logger';
import { BootstrapError } from '../utils/errors';
import { authedGet } from '../config/r2Client';
import { MANIFEST_URL } from '../config/defaults';

// Manifest shape as published in assets/r2-manifest.json. Only the fields we
// actually consume are modeled - we keep this narrow on purpose to avoid
// having to keep types in sync with upstream for fields we don't use.
export interface BinaryEntry {
  key: string;
  url: string;
  installPath: string; // e.g. "sui/sui.exe" - we only use the basename.
  size: number;
  sha256: string;
}

export interface Manifest {
  version: string;
  generatedAt: string;
  binaries: BinaryEntry[];
}

// Tunables. We expose the two most useful knobs via env vars so users on
// flaky networks can serialize downloads and stretch the idle timeout
// without editing code:
//   CMDO_DOWNLOAD_CONCURRENCY   default 3
//   CMDO_DOWNLOAD_IDLE_MS       default 120000  (per-chunk idle watchdog)
//   CMDO_DOWNLOAD_RETRIES       default 3       (attempts per file)
const IDLE_MS = Number(process.env.CMDO_DOWNLOAD_IDLE_MS) || 120_000;
const MAX_RETRIES = Number(process.env.CMDO_DOWNLOAD_RETRIES) || 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Single attempt. Supports HTTP Range resume: if `tmpPath` already has N
// bytes from a previous aborted run, we ask the server to start at byte N.
// We manage our own idle watchdog instead of relying on axios `timeout`,
// which on v1 applies to the whole request and is too blunt for stream
// downloads over slow links.
async function attemptDownload(
  entry: BinaryEntry,
  destPath: string,
  tmpPath: string,
): Promise<void> {
  const name = path.basename(entry.installPath);

  // Pre-existing .part bytes (possibly from a prior failed attempt).
  let already = 0;
  try {
    already = (await fsp.stat(tmpPath)).size;
  } catch {
    already = 0;
  }

  const headers: Record<string, string> = {};
  if (already > 0 && already < entry.size) {
    headers['Range'] = `bytes=${already}-`;
  } else if (already >= entry.size) {
    // Corrupt or over-sized partial; start fresh.
    await fsp.unlink(tmpPath).catch(() => {});
    already = 0;
  }

  // Use authedGet so the request carries the R2 worker auth token. The
  // underlying axios config still requests a stream body and a permissive
  // status validator (we inspect 200/206 ourselves below).
  const response = await authedGet(entry.url, {
    responseType: 'stream',
    maxRedirects: 5,
    headers,
    timeout: 30_000,
  });
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`unexpected HTTP ${response.status} for ${name}`);
  }

  const resumed = response.status === 206 && already > 0;
  if (resumed) {
    log.info(`resuming ${name} at ${(already / 1024 / 1024).toFixed(1)} MB`);
  } else if (already > 0) {
    // Server ignored Range - rewrite from scratch.
    await fsp.unlink(tmpPath).catch(() => {});
    already = 0;
  }

  const writer = fs.createWriteStream(tmpPath, {
    flags: resumed ? 'a' : 'w',
  });

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
        () => finish(new Error(`idle timeout (${IDLE_MS}ms) on ${name}`)),
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

// Downloads a single binary with retry + Range resume, then verifies SHA256.
// A hash mismatch is considered unrecoverable (bad source data or tampering)
// and does NOT trigger a retry - we fail loudly instead.
async function downloadOne(
  entry: BinaryEntry,
  destPath: string,
): Promise<void> {
  const name = path.basename(entry.installPath);
  log.info(`downloading ${name} (${(entry.size / 1024 / 1024).toFixed(1)} MB)`);

  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = destPath + '.part';

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await attemptDownload(entry, destPath, tmpPath);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      const remaining = MAX_RETRIES - attempt;
      if (remaining <= 0) break;
      // Exponential backoff: 2s, 5s, 10s...
      const delay = attempt === 1 ? 2_000 : attempt === 2 ? 5_000 : 10_000;
      log.warn(
        `download of ${name} failed (attempt ${attempt}/${MAX_RETRIES}): ${(err as Error).message}. retrying in ${delay / 1000}s...`,
      );
      await sleep(delay);
    }
  }

  if (lastErr) {
    throw new BootstrapError(
      `Network error fetching ${name} after ${MAX_RETRIES} attempts`,
      'Check your internet connection and retry `npm run bootstrap`. Partial file kept for resume.',
      lastErr,
    );
  }

  // Verify SHA256. This is mandatory - without it the installer has no
  // provenance guarantee at all.
  const actual = await sha256File(tmpPath);
  if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw new BootstrapError(
      `SHA256 mismatch for ${name}`,
      `expected ${entry.sha256}\n         got      ${actual}`,
    );
  }

  // Atomic-ish rename once the hash is confirmed.
  await fsp.rename(tmpPath, destPath);
  log.success(`installed ${name}`);
}

// Downloads every binary in the manifest into the flat bin directory. We run
// a small concurrency pool (default 3) so the installer is reasonably fast
// without hammering the CDN or the user's disk.
export async function downloadAll(
  manifest: Manifest,
  binDir: string,
  concurrency = Number(process.env.CMDO_DOWNLOAD_CONCURRENCY) || 3,
): Promise<void> {
  await fsp.mkdir(binDir, { recursive: true });
  log.info(
    `download settings: concurrency=${concurrency} idleTimeout=${IDLE_MS}ms retries=${MAX_RETRIES}`,
  );

  const queue = [...manifest.binaries];
  const workers: Promise<void>[] = [];

  const runWorker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) return;
      const name = path.basename(entry.installPath);
      const dest = path.join(binDir, name);

      // Skip re-download if file already exists AND hash matches. This makes
      // re-running bootstrap cheap and idempotent.
      if (fs.existsSync(dest)) {
        try {
          const existing = await sha256File(dest);
          if (existing.toLowerCase() === entry.sha256.toLowerCase()) {
            log.info(`already installed: ${name}`);
            continue;
          }
        } catch {
          // fall through to re-download
        }
      }

      await downloadOne(entry, dest);
    }
  };

  for (let i = 0; i < concurrency; i++) workers.push(runWorker());
  await Promise.all(workers);
}

// Fetches and validates the manifest from the R2 worker.
//
// By design we do NOT fall back to a bundled copy: the shipped manifest
// would quickly drift from the real object hashes, and a silent fallback
// would just produce SHA256 mismatches on every download instead of a
// clear network error. If the user is offline, fail loudly here.
export async function loadManifest(): Promise<Manifest> {
  log.info(`fetching manifest from ${MANIFEST_URL}`);
  let res;
  try {
    res = await authedGet(MANIFEST_URL, {
      responseType: 'json',
      timeout: 30_000,
      maxRedirects: 5,
    });
  } catch (err) {
    throw new BootstrapError(
      'Could not fetch manifest',
      'Check your internet connection and retry `npm run bootstrap`.',
      err,
    );
  }

  const parsed =
    typeof res.data === 'string'
      ? (JSON.parse(res.data) as Manifest)
      : (res.data as Manifest);
  if (!parsed?.binaries?.length) {
    throw new BootstrapError(
      'Manifest response had no binaries',
      `URL: ${MANIFEST_URL}`,
    );
  }
  return parsed;
}
