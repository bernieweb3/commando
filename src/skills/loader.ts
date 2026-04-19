import fs from 'node:fs';
import { PATHS } from '../bootstrap/paths';

// The skill loader parses the auto-generated AGENT.md and slices it into
// per-tool sections. The router hands only the relevant section to the LLM
// so the prompt stays small and the validator can check that every flag
// emitted by the LLM actually exists.

export interface ToolContext {
  tool: string; // "sui" | "walrus" | "site-builder"
  section: string; // raw markdown for prompt injection
  allowedCommands: string[]; // first token(s) of each bullet
  allowedFlags: Set<string>; // every `--flag` the tool accepts
}

function loadRaw(): string {
  if (!fs.existsSync(PATHS.agentMd)) return '';
  return fs.readFileSync(PATHS.agentMd, 'utf8');
}

export function sliceByTool(md: string, tool: string): string {
  const lines = md.split(/\r?\n/);
  const startIdx = lines.findIndex(
    (l) => l.trim().toLowerCase() === `## tool: ${tool.toLowerCase()}`,
  );
  if (startIdx < 0) return '';
  let end = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^## Tool:/i.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(startIdx, end).join('\n');
}

export function getToolContext(tool: string): ToolContext {
  const md = loadRaw();
  const section = sliceByTool(md, tool);
  const allowedCommands: string[] = [];
  const allowedFlags = new Set<string>();

  // Bullets look like:
  //   - `sui client active-address --json --foo` - description
  for (const line of section.split(/\r?\n/)) {
    const m = /^-\s+`([^`]+)`/.exec(line);
    if (!m) continue;
    const signature = m[1];
    // Drop the tool name prefix; keep the command portion.
    const parts = signature.split(/\s+/);
    if (parts.length < 2) continue;
    // Everything up to the first flag is the command path.
    const cmdParts: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].startsWith('-')) break;
      cmdParts.push(parts[i]);
    }
    if (cmdParts.length) allowedCommands.push(cmdParts.join(' '));
    for (const p of parts.slice(1)) {
      if (p.startsWith('--')) allowedFlags.add(p);
      else if (/^-[a-zA-Z]$/.test(p)) allowedFlags.add(p);
    }
  }

  return { tool, section, allowedCommands, allowedFlags };
}
