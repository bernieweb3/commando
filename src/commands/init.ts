import readline from 'node:readline';
import {
  readUserConfig,
  writeUserConfig,
  configPath,
  Provider,
} from '../config/userConfig';
import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
} from '../config/defaults';
import { log } from '../utils/logger';

// Interactive setup for user-scoped LLM credentials. The flow is:
//   1. Pick a provider (openai | openrouter).
//   2. Enter the API key (masked).
//   3. Pick the model - numeric dropdown for OpenAI, free-text slug for
//      OpenRouter. This split matches how each service is actually used:
//      OpenAI has a small stable roster; OpenRouter has hundreds of slugs
//      that rotate frequently and users usually know exactly what they want.

// ---------- prompt helpers ----------

function askPlain(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Raw-mode stdin reader: echoes '*' for every typed character so secrets
// never appear in the scrollback. Backspace edits, Enter commits, Ctrl+C
// aborts cleanly.
function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(question);

    const hadRaw = stdin.isRaw;
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buffer = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (typeof stdin.setRawMode === 'function') stdin.setRawMode(hadRaw);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === '\n' || ch === '\r') {
          stdout.write('\n');
          cleanup();
          resolve(buffer);
          return;
        }
        if (code === 3) {
          stdout.write('\n');
          cleanup();
          reject(new Error('aborted by user (Ctrl+C)'));
          return;
        }
        if (code === 127 || code === 8) {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }
        if (code < 32) continue;
        buffer += ch;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// ---------- step-specific pickers ----------

async function pickProvider(current: Provider | undefined): Promise<Provider> {
  const providers: { id: Provider; label: string }[] = [
    { id: 'openai', label: 'OpenAI (direct, dropdown of official models)' },
    { id: 'openrouter', label: 'OpenRouter (any model slug, free tier friendly)' },
  ];

  console.log('');
  console.log('Select LLM provider:');
  providers.forEach((p, i) => {
    const marker = p.id === current ? ' (current)' : '';
    console.log(`  ${i + 1}) ${p.label}${marker}`);
  });

  const defaultIdx = Math.max(
    0,
    providers.findIndex((p) => p.id === current),
  );
  const defaultLabel = providers[defaultIdx].id;

  while (true) {
    const raw = await askPlain(
      `Provider [${defaultIdx + 1}=${defaultLabel}]: `,
    );
    if (!raw) return providers[defaultIdx].id;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= providers.length) {
      return providers[n - 1].id;
    }
    // Accept text shortcut too: "openai" or "openrouter".
    const byName = providers.find((p) => p.id === raw.toLowerCase());
    if (byName) return byName.id;
    log.warn('invalid choice, try again.');
  }
}

async function pickOpenAIModel(current: string | undefined): Promise<string> {
  const defaultIdx = Math.max(
    0,
    OPENAI_MODELS.findIndex((m) => m.id === current),
  );
  const chosenDefault =
    OPENAI_MODELS[defaultIdx]?.id || DEFAULT_OPENAI_MODEL;

  console.log('');
  console.log('Select OpenAI model:');
  OPENAI_MODELS.forEach((m, i) => {
    const marker = m.id === current ? ' (current)' : '';
    console.log(`  ${i + 1}) ${m.label.padEnd(14)} - ${m.note}${marker}`);
  });

  while (true) {
    const raw = await askPlain(
      `Model [${defaultIdx + 1}=${chosenDefault}]: `,
    );
    if (!raw) return chosenDefault;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= OPENAI_MODELS.length) {
      return OPENAI_MODELS[n - 1].id;
    }
    // Allow typing the slug directly as an escape hatch for users who
    // follow a specific model not in the curated list.
    if (raw.length > 0) return raw;
    log.warn('invalid choice, try again.');
  }
}

async function askOpenRouterModel(current: string | undefined): Promise<string> {
  const def = current || DEFAULT_OPENROUTER_MODEL;
  console.log('');
  console.log(
    'OpenRouter model slug (see https://openrouter.ai/models for the full list).',
  );
  const raw = await askPlain(`Model [${def}]: `);
  return raw || def;
}

// ---------- main command ----------

export async function initCmd(): Promise<number> {
  const current = readUserConfig();

  try {
    log.info('commando init - configure LLM provider and credentials');
    log.info(`config will be saved to: ${configPath()}`);
    log.info('press Enter at any prompt to keep the current/default value.');

    const provider = await pickProvider(current.provider);

    const keyLabel =
      current.provider === provider && current.apiKey ? 'configured' : 'none';
    const keyAnswer = await askSecret(
      `${provider === 'openai' ? 'OpenAI' : 'OpenRouter'} API key [${keyLabel}]: `,
    );

    const model =
      provider === 'openai'
        ? await pickOpenAIModel(
            current.provider === 'openai' ? current.model : undefined,
          )
        : await askOpenRouterModel(
            current.provider === 'openrouter' ? current.model : undefined,
          );

    // Preserve the existing key when the user pressed Enter AND the provider
    // is unchanged; otherwise treat the blank as "no key yet".
    const apiKey =
      keyAnswer ||
      (current.provider === provider ? current.apiKey : undefined);

    await writeUserConfig({ provider, apiKey, model });
    log.success('configuration saved.');
    log.info(`provider: ${provider}`);
    log.info(`active model: ${model}`);
    if (!apiKey) {
      log.warn(
        'no API key set - Commando will fall back to the offline mock planner.',
      );
    }
    return 0;
  } catch (err) {
    log.error('init failed:', (err as Error).message);
    return 1;
  }
}
