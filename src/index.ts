import { Command } from 'commander';
import { runPrompt } from './commands/run';
import { updateSkillsCmd } from './commands/updateSkills';
import { doctorCmd } from './commands/doctor';
import { initCmd } from './commands/init';
import { runBootstrap } from './bootstrap/postinstall';
import { log } from './utils/logger';

// Commander-based entrypoint. Design choice: the default action takes a free
// text prompt as a positional arg so the common case - `cmdo "show address"`
// - reads naturally. Sub-commands (update-skills, doctor, bootstrap) are
// reserved words that don't collide with real user prompts.

const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('cmdo')
  .description(
    'Commando - Natural language CLI agent for the Sui ecosystem (Windows, Linux, macOS).',
  )
  .version(pkg.version, '-v, --version', 'Print version');

program
  .command('init')
  .description('Interactively configure LLM provider (OpenAI or OpenRouter), API key, and model.')
  .action(async () => {
    const code = await initCmd();
    process.exit(code);
  });

program
  .command('update-skills')
  .description('Regenerate ~/.commando/skills/AGENT.md from current binaries.')
  .action(async () => {
    const code = await updateSkillsCmd();
    process.exit(code);
  });

program
  .command('doctor')
  .description('Show environment status and verify installed binaries.')
  .action(async () => {
    const code = await doctorCmd();
    process.exit(code);
  });

program
  .command('bootstrap')
  .description('Download binaries, add to PATH, and generate skills (idempotent).')
  .action(async () => {
    try {
      await runBootstrap();
      process.exit(0);
    } catch (err) {
      log.error((err as Error).message);
      process.exit(1);
    }
  });

// Default command: everything that isn't a known subcommand is treated as a
// natural-language prompt. Tool selection is either explicit (--sui/--walrus
// /--site-builder) or inferred from keywords.
program
  .argument('[prompt...]', 'Natural language request')
  .option('--sui', 'Force routing to the sui binary')
  .option('--walrus', 'Force routing to the walrus binary')
  .option('--site-builder', 'Force routing to the site-builder binary')
  .action(async (promptParts: string[], opts: Record<string, boolean>) => {
    const prompt = (promptParts || []).join(' ').trim();
    if (!prompt) {
      program.help();
      return;
    }
    const code = await runPrompt(prompt, {
      sui: !!opts.sui,
      walrus: !!opts.walrus,
      siteBuilder: !!opts.siteBuilder,
    });
    process.exit(code);
  });

program.parseAsync(process.argv).catch((err) => {
  log.error((err as Error).message);
  process.exit(1);
});
