import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PATHS, binaryPath } from '../bootstrap/paths';
import { toolFilename, TOOL_BASENAMES, ToolBase } from '../bootstrap/platform';
import { log } from '../utils/logger';

const pexec = promisify(execFile);

// We intentionally generate skills for the three *user-facing* tools only.
// Extra service binaries (sui-node, sui-faucet, walrus-node, ...) exist to
// unblock local dev scenarios but are not something the LLM should plan
// against - including their help text would bloat the context window.
//
// Tool names are resolved per-platform (sui.exe on Windows, sui on Unix) so
// the probe loop finds the right file in ~/.commando/bin.
const TARGET_TOOLS: ReadonlyArray<string> = TOOL_BASENAMES.map((b) =>
  toolFilename(b as ToolBase),
);
type ToolName = string;

interface CommandEntry {
  name: string; // e.g. "client active-address"
  description: string;
  flags: string[]; // collected from `<bin> <cmd> --help`
  // Nested subcommands discovered when this entry is itself a command group
  // (e.g. `sui client` -> `active-address`, `gas`, ...). For leaf commands
  // this stays empty. We only recurse 2 levels deep because that covers
  // every Mysten Labs CLI today and keeps the prompt under ~6k tokens.
  subcommands?: CommandEntry[];
}

interface ToolSkill {
  tool: ToolName;
  topLevelOptions: string[];
  commands: CommandEntry[];
}

// Run a binary with a timeout and return stdout (merged with stderr because
// some tools write --help to stderr on non-zero exit).
async function runHelp(
  binary: string,
  args: string[],
  timeoutMs = 8_000,
): Promise<string> {
  try {
    const { stdout, stderr } = await pexec(binary, args, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout + '\n' + stderr;
  } catch (err: unknown) {
    // execFile throws on non-zero exit, but the stdout is still populated.
    const e = err as { stdout?: string; stderr?: string };
    if (e.stdout || e.stderr) return (e.stdout || '') + '\n' + (e.stderr || '');
    throw err;
  }
}

// Extract a section like "Commands:" or "Options:" from clap-style help.
// Returns the raw block of lines between the header and the next top-level
// header (or EOF). Clap indents entries with 2+ spaces, which we rely on.
function extractSection(help: string, header: string): string[] {
  const lines = help.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.trim().toLowerCase() === header.toLowerCase()) {
      inSection = true;
      continue;
    }
    if (inSection) {
      // A new top-level header ends the section.
      if (/^[A-Z][A-Za-z0-9 ]+:\s*$/.test(line)) break;
      if (line.trim() === '' && out.length > 0 && out[out.length - 1] === '') {
        // Collapse double blanks but allow trailing blank once.
        continue;
      }
      out.push(line);
    }
  }
  return out;
}

// Parse the "Commands:" block. Each command line looks like:
//    `  client   Client for interacting with ...`
// Continuation lines are indented deeper. We only capture the first token
// of the first line as the command name.
function parseCommands(block: string[]): CommandEntry[] {
  const commands: CommandEntry[] = [];
  let current: CommandEntry | null = null;
  for (const raw of block) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    // Top-level command entries: 2-space indent, then name, then whitespace.
    const m = /^ {2}(\S+)\s+(.*)$/.exec(line);
    if (m && !/^\s{4,}/.test(line)) {
      current = { name: m[1], description: m[2].trim(), flags: [] };
      commands.push(current);
    } else if (current) {
      // Continuation of the previous command description.
      current.description += ' ' + line.trim();
    }
  }
  // Skip synthetic "help" command.
  return commands.filter((c) => c.name !== 'help' && !c.name.startsWith('-'));
}

// Parse "Options:" block into a deduplicated list of flag names, e.g. "--foo".
function parseFlags(block: string[]): string[] {
  const flags = new Set<string>();
  for (const line of block) {
    // Examples:
    //   "  -q, --quiet    Display less output"
    //   "      --path <PATH>    ..."
    const longs = line.match(/--[a-zA-Z][a-zA-Z0-9\-]*/g);
    if (longs) for (const l of longs) flags.add(l);
    const shorts = line.match(/(?:^|\s)(-[a-zA-Z])(?=[,\s])/g);
    if (shorts) for (const s of shorts) flags.add(s.trim().replace(/,$/, ''));
  }
  return [...flags];
}

async function probeTool(tool: ToolName): Promise<ToolSkill | null> {
  const binary = binaryPath(tool);

  let help: string;
  try {
    help = await runHelp(binary, ['--help']);
  } catch (err) {
    log.warn(`could not probe ${tool}: ${(err as Error).message}`);
    return null;
  }

  const commandBlock = extractSection(help, 'Commands:');
  const optionBlock = extractSection(help, 'Options:');
  const commands = parseCommands(commandBlock);
  const topLevelOptions = parseFlags(optionBlock);

  // Second pass: probe each top-level command. Two things can happen:
  //   1. It's a leaf command (e.g. `sui --version`) -> just collect flags.
  //   2. It's a command group (e.g. `sui client`)   -> ALSO list its
  //      nested subcommands (`active-address`, `gas`, ...) and probe each
  //      for flags. Without this step the LLM never sees commands like
  //      `sui client active-address`, so it returns plans that stop at the
  //      group name and the binary just prints its own help text.
  // Parallelism capped at 3 to be gentle on slow machines.
  const subs = [...commands];
  const pool = 3;
  await Promise.all(
    Array.from({ length: pool }, async () => {
      while (subs.length) {
        const cmd = subs.shift();
        if (!cmd) return;
        try {
          const sub = await runHelp(binary, [cmd.name, '--help'], 5_000);
          cmd.flags = parseFlags(extractSection(sub, 'Options:'));

          // If this command exposes its own Commands: block, treat it as a
          // group and recurse one more level.
          const nestedBlock = extractSection(sub, 'Commands:');
          const nested = parseCommands(nestedBlock);
          if (nested.length) {
            cmd.subcommands = nested;
            // Probe each nested command's flags too. Sequential here is
            // fine - we're already inside a parallel outer pool and these
            // bursts are short.
            for (const child of nested) {
              try {
                const childHelp = await runHelp(
                  binary,
                  [cmd.name, child.name, '--help'],
                  5_000,
                );
                child.flags = parseFlags(
                  extractSection(childHelp, 'Options:'),
                );
              } catch {
                // Some leaf commands refuse --help when they expect
                // positional args; skip silently.
              }
            }
          }
        } catch {
          // Best-effort; some subcommands take positional arg groups and
          // refuse --help. Leave flags empty and move on.
        }
      }
    }),
  );

  return { tool, topLevelOptions, commands };
}

function renderMarkdown(skills: ToolSkill[]): string {
  const lines: string[] = [];
  lines.push('# Commando Skill Manifest');
  lines.push('');
  lines.push(
    '> Auto-generated from `<tool> --help`. Do not edit by hand - run `cmdo update-skills`.',
  );
  lines.push('');

  for (const s of skills) {
    // Strip the extension so the rendered markdown always uses the bare
    // tool name ("sui") regardless of which OS generated it. The loader,
    // planner and safety gate all agree on the bare-name shape.
    const toolBase = s.tool.replace(/\.exe$/i, '');
    lines.push(`## Tool: ${toolBase}`);
    lines.push('');
    if (s.topLevelOptions.length) {
      lines.push('### Global Options');
      for (const f of s.topLevelOptions) lines.push(`- \`${f}\``);
      lines.push('');
    }
    lines.push('### Commands');
    for (const c of s.commands) {
      const flagSuffix = c.flags.length ? ' ' + c.flags.join(' ') : '';
      lines.push(
        `- \`${toolBase} ${c.name}${flagSuffix}\` - ${c.description}`,
      );
      // Emit nested subcommands as their own bullets so the loader (which
      // keys off the first backtick-quoted token) sees them as first-class
      // allowed commands. The full path (`sui client active-address`) is
      // what the LLM must reproduce verbatim in `args`.
      if (c.subcommands && c.subcommands.length) {
        for (const child of c.subcommands) {
          const childFlags = child.flags.length
            ? ' ' + child.flags.join(' ')
            : '';
          lines.push(
            `- \`${toolBase} ${c.name} ${child.name}${childFlags}\` - ${child.description}`,
          );
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// Public entrypoint used by both postinstall and `cmdo update-skills`.
export async function generateSkills(): Promise<string> {
  log.info('generating skill manifest...');
  const skills: ToolSkill[] = [];
  for (const tool of TARGET_TOOLS) {
    const s = await probeTool(tool);
    if (s) skills.push(s);
  }

  if (!skills.length) {
    log.warn('no tools probed successfully; AGENT.md not written.');
    return '';
  }

  const md = renderMarkdown(skills);
  await fsp.mkdir(PATHS.skills, { recursive: true });
  await fsp.writeFile(PATHS.agentMd, md, 'utf8');
  log.success(`wrote ${PATHS.agentMd}`);
  return md;
}
