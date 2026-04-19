import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { log } from '../utils/logger';

// Adds `~/.commando/bin` to the user's shell PATH without requiring admin /
// root privileges, on all three target platforms.
//
//   Windows : write HKCU\Environment\Path via reg.exe, then trigger
//             WM_SETTINGCHANGE by touching a COMMANDO_BIN variable with setx.
//   macOS   : append a `export PATH=...` line to ~/.zshrc (default shell
//             since Catalina). We also write ~/.bash_profile if it exists
//             for users who pinned bash.
//   Linux   : append to ~/.bashrc and ~/.zshrc if they exist.
//
// The currently-running process also gets its in-memory PATH patched so the
// immediately-following skill-generation step can find the new binaries.

// ---------------- Windows ----------------

const WIN_KEY = 'HKCU\\Environment';

function readWindowsUserPath(): string {
  try {
    const out = execFileSync(
      'reg',
      ['query', WIN_KEY, '/v', 'Path'],
      { encoding: 'utf8' },
    );
    const match = out.match(/Path\s+REG_(SZ|EXPAND_SZ)\s+(.*)/i);
    return match ? match[2].trim() : '';
  } catch {
    return '';
  }
}

function writeWindowsUserPath(value: string): void {
  execFileSync(
    'reg',
    ['add', WIN_KEY, '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'],
    { stdio: 'ignore' },
  );
}

function addToWindowsPath(dir: string): void {
  const current = readWindowsUserPath();
  const segments = current.split(';').map((s) => s.trim()).filter(Boolean);
  const already = segments.some(
    (s) => s.toLowerCase() === dir.toLowerCase(),
  );

  if (already) {
    log.info(`PATH already contains ${dir}`);
    return;
  }

  const next = segments.length ? `${current};${dir}` : dir;
  try {
    writeWindowsUserPath(next);
    log.success(`added ${dir} to user PATH`);
  } catch (err) {
    log.warn(
      'failed to update user PATH via registry; you can add it manually:',
      dir,
    );
    log.debug(err);
    return;
  }

  // Broadcast WM_SETTINGCHANGE so new shells see the change without a
  // logout/logon cycle. setx does this as a side effect.
  try {
    execFileSync('setx', ['COMMANDO_BIN', dir], { stdio: 'ignore' });
  } catch {
    // Non-fatal: PATH is already persisted in the registry.
  }
}

// ---------------- Unix (Linux + macOS) ----------------

// Marker comment used to identify the line we inserted. Lets us detect an
// existing entry on re-runs and update it in place without duplicating.
const UNIX_MARKER = '# added by commando bootstrap';

// The shell rc files we patch. Order matters only for logging; we always
// touch every file that exists so that both bash and zsh users are covered
// (dual-shell workflows are common on macOS when devs install oh-my-zsh
// but keep bash for scripts).
function unixRcCandidates(): string[] {
  const home = os.homedir();
  const files = [
    path.join(home, '.zshrc'),
    path.join(home, '.bashrc'),
    // ~/.bash_profile is used by login shells on macOS; touch it too if
    // present so login-shell-only terminals pick up the change.
    path.join(home, '.bash_profile'),
    // ~/.profile is the POSIX fallback for login shells on most Linux
    // distros (Debian/Ubuntu in particular); patch it when present so
    // even fish/dash users who `source ~/.profile` get the PATH update.
    path.join(home, '.profile'),
  ];
  return files;
}

function addToUnixPath(dir: string): void {
  const files = unixRcCandidates();
  const line = `export PATH="${dir}:$PATH" ${UNIX_MARKER}`;

  let touched = 0;
  let preExisting = 0;

  for (const rc of files) {
    // Only touch files that already exist. Creating a .zshrc on a pure-bash
    // system (or vice-versa) would change the shell startup semantics for
    // the user - they might suddenly get a .zshrc-triggered oh-my-zsh
    // install prompt, for example. Stay conservative.
    if (!fs.existsSync(rc)) continue;

    const content = fs.readFileSync(rc, 'utf8');
    if (content.includes(dir)) {
      // Either our own marker line or an unrelated entry that already points
      // at the right directory. Either way, no action needed.
      preExisting += 1;
      continue;
    }

    // Append with a leading newline so we don't glue to the previous line
    // if the file doesn't end with \n (common when users hand-edit rc).
    const prefix = content.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(rc, `${prefix}${line}\n`);
    log.success(`added ${dir} to ${rc}`);
    touched += 1;
  }

  if (touched === 0 && preExisting === 0) {
    // No rc file existed at all (rare - happens in minimal Docker images).
    // Write ~/.profile as a sensible default so a subsequent login shell
    // picks up the PATH.
    const fallback = path.join(os.homedir(), '.profile');
    fs.writeFileSync(fallback, `${line}\n`, 'utf8');
    log.success(`created ${fallback} with PATH entry for ${dir}`);
  } else if (touched === 0) {
    log.info(`PATH already contains ${dir} in shell rc files`);
  }

  log.info(
    'open a new shell (or run `source ~/.zshrc`/`source ~/.bashrc`) to pick up the change.',
  );
}

// ---------------- Entrypoint ----------------

export function addToUserPath(dir: string): void {
  if (process.platform === 'win32') {
    addToWindowsPath(dir);
  } else {
    addToUnixPath(dir);
  }

  // Always patch the in-process env too. The skill-generation step that
  // runs right after uses spawn()/execFile() which inherit this copy of
  // PATH, so without this patch the `sui --help` probe would fail on a
  // freshly-installed machine.
  const sep = process.platform === 'win32' ? ';' : ':';
  const envPath = process.env.PATH || process.env.Path || '';
  const already = envPath
    .split(sep)
    .some((s) => s.trim().toLowerCase() === dir.toLowerCase());
  if (!already) {
    const updated = envPath ? `${envPath}${sep}${dir}` : dir;
    process.env.PATH = updated;
    if (process.platform === 'win32') process.env.Path = updated;
  }
}
