import { homedir } from 'node:os';
import path from 'node:path';

// Central location for every filesystem path Commando cares about.
// Keeping these in one module makes it trivial to swap the install root
// during tests (e.g. COMMANDO_HOME env var) and guarantees the bin dir stays
// flat so `spawn` calls can reliably resolve binary names.

const ROOT = process.env.COMMANDO_HOME || path.join(homedir(), '.commando');

export const PATHS = {
  root: ROOT,
  bin: path.join(ROOT, 'bin'),
  skills: path.join(ROOT, 'skills'),
  agentMd: path.join(ROOT, 'skills', 'AGENT.md'),
  sandboxRoot: path.join(ROOT, 'sandbox', 'default'),
  sandboxConfig: path.join(ROOT, 'sandbox', 'default', 'config'),
  sandboxKeystore: path.join(ROOT, 'sandbox', 'default', 'keystore'),
} as const;

// Resolves a binary name (e.g. "sui.exe") to its absolute path inside the
// flat bin directory. The exec engine validates that the resolved path is
// still inside PATHS.bin before spawning.
export function binaryPath(name: string): string {
  return path.join(PATHS.bin, name);
}
