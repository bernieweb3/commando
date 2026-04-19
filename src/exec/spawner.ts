import { spawn } from 'node:child_process';
import path from 'node:path';
import { log } from '../utils/logger';

// Thin wrapper around child_process.spawn. Critical design points:
//   - shell:false  -> no shell interpolation, argv is passed literally.
//   - stdout stays inherited so native binary output reaches the user
//     exactly as if they had run the binary directly.
//   - stderr is TEE'd: we pipe the real bytes straight through to our
//     own process.stderr (so the user sees progress live), AND we keep
//     a small tail buffer so that on non-zero exit we can recognise
//     well-known failure modes (e.g. walrus missing its config file)
//     and append an actionable hint for the user.
//   - windowsHide -> prevents extra console window flashes on Windows.
// Returns the process exit code so the CLI can exit with the same code.

// Patterns we recognise in stderr and map to a single-line hint. Keep
// this list small and boring - false positives are worse than a few
// missed cases because they would confuse users about what really
// failed.
const FAILURE_HINTS: { test: RegExp; hint: () => string }[] = [
  {
    // walrus prints: "Error: could not find a valid Walrus configuration file"
    test: /could not find a valid Walrus configuration file/i,
    hint: () =>
      'walrus could not find its config. Create it with:\n' +
      '  curl --create-dirs https://docs.wal.app/setup/client_config.yaml -o ~/.config/walrus/client_config.yaml\n' +
      'Or re-run `cmdo bootstrap` to auto-download it.',
  },
  {
    // sui prints: "No sui config found in `...`, create one [Y/n]?"
    // This only happens when stdin is non-interactive (CI/scripts).
    test: /No sui config found in/i,
    hint: () =>
      'sui needs a wallet config. Run `cmdo bootstrap` to auto-create it, or:\n' +
      '  sui client   # follow the interactive prompts',
  },
  {
    // walrus prints this when the sui wallet is missing/empty.
    test: /no.*active\s+sui\s+address/i,
    hint: () =>
      'no active sui address. Create one with:\n' +
      '  sui client new-address ed25519',
  },
];

const TAIL_CAP = 16 * 1024;

export function runBinary(
  binary: string,
  args: string[],
  cwd: string = process.cwd(),
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      shell: false,
      // stdin: inherit (user can type secrets etc)
      // stdout: inherit (live output)
      // stderr: pipe (we tee-forward it below)
      stdio: ['inherit', 'inherit', 'pipe'],
      windowsHide: true,
    });

    // Tail buffer for post-hoc hint matching. We cap the buffer so a
    // chatty subprocess can't balloon Commando's memory; keeping only
    // the tail is good enough because error lines are always last.
    let tail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      // Forward verbatim first so the user sees normal stderr output.
      process.stderr.write(chunk);
      const s = chunk.toString('utf8');
      tail = (tail + s).slice(-TAIL_CAP);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      const exit = code ?? 0;
      if (exit !== 0) {
        for (const { test, hint } of FAILURE_HINTS) {
          if (test.test(tail)) {
            log.info(`hint (${path.basename(binary)}): ${hint()}`);
            break;
          }
        }
      }
      resolve(exit);
    });
  });
}
