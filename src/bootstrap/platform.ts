import os from 'node:os';

// Centralised platform detection used by every cross-platform code path
// (bootstrap download, PATH patching, binary name resolution, skill
// generation, safety gate). Keeping the arch/os mapping in ONE place means
// adding a new platform is a single-file edit.

export type TargetOS = 'windows' | 'linux' | 'macos';
export type TargetArch = 'x86_64' | 'aarch64' | 'arm64';

export interface TargetPlatform {
  os: TargetOS;
  arch: TargetArch;
  // Composite key used by the GitHub download URL map, e.g. "linux-x86_64".
  key: string;
  // Binary file extension including the dot, or empty string on Unix.
  exeSuffix: '' | '.exe';
}

// Translate Node's `process.platform` + `os.arch()` into our own axes. We
// deliberately collapse `darwin` to `macos` and `win32` to `windows` so the
// rest of the codebase speaks in user-facing vocabulary.
export function detectPlatform(): TargetPlatform {
  const nodePlat = process.platform;
  const nodeArch = os.arch(); // 'x64' | 'arm64' | 'ia32' | ...

  let targetOS: TargetOS;
  if (nodePlat === 'win32') targetOS = 'windows';
  else if (nodePlat === 'darwin') targetOS = 'macos';
  else if (nodePlat === 'linux') targetOS = 'linux';
  else {
    throw new Error(
      `Unsupported OS "${nodePlat}"; Commando supports Windows, Linux, macOS only.`,
    );
  }

  // macOS uses Apple's "arm64" label upstream; Linux ships "aarch64" in its
  // release tarballs. Node reports both as "arm64", so we pick the token that
  // matches the upstream GitHub asset naming convention.
  let targetArch: TargetArch;
  if (nodeArch === 'x64') {
    targetArch = 'x86_64';
  } else if (nodeArch === 'arm64') {
    targetArch = targetOS === 'macos' ? 'arm64' : 'aarch64';
  } else {
    throw new Error(
      `Unsupported CPU architecture "${nodeArch}"; expected x64 or arm64.`,
    );
  }

  const exeSuffix: '' | '.exe' = targetOS === 'windows' ? '.exe' : '';
  return {
    os: targetOS,
    arch: targetArch,
    key: `${targetOS}-${targetArch}`,
    exeSuffix,
  };
}

// Cached singleton. Platform never changes during a process lifetime so we
// avoid re-running the detection switch on every call site.
let cached: TargetPlatform | null = null;
export function platform(): TargetPlatform {
  if (!cached) cached = detectPlatform();
  return cached;
}

// Convenience: the three user-facing tool names with the right extension for
// the current platform (e.g. ["sui.exe", "walrus.exe", "site-builder.exe"]
// on Windows, ["sui", "walrus", "site-builder"] on Unix). Anywhere in the
// code that used to hardcode ".exe" should resolve the name via this helper
// instead.
export const TOOL_BASENAMES = ['sui', 'walrus', 'site-builder'] as const;
export type ToolBase = (typeof TOOL_BASENAMES)[number];

export function toolFilename(base: ToolBase): string {
  return `${base}${platform().exeSuffix}`;
}

export function isWindows(): boolean {
  return platform().os === 'windows';
}
