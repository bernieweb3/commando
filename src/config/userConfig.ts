import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PATHS } from '../bootstrap/paths';
import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENAI_MODEL,
} from './defaults';

// User-scoped configuration stored in ~/.commando/config.json. This is the
// ONLY place we persist user secrets. It is NOT shipped with the package
// and is never overwritten by a re-install.
//
// v2 schema (2026-04) unifies OpenAI and OpenRouter under a single
// `{provider, apiKey, model}` shape. The legacy schema (openrouterApiKey /
// openrouterModel) is migrated silently on first read so existing installs
// keep working without user action.

export type Provider = 'openai' | 'openrouter';

export interface UserConfig {
  provider?: Provider;
  apiKey?: string;
  model?: string;
}

// Older pre-v2 shape, kept only so readUserConfig() can recognise and
// upgrade it. Fields are optional because a user might have only set one.
interface LegacyUserConfig {
  openrouterApiKey?: string;
  openrouterModel?: string;
}

const CONFIG_PATH = path.join(PATHS.root, 'config.json');

export function configPath(): string {
  return CONFIG_PATH;
}

function migrate(raw: UserConfig & LegacyUserConfig): UserConfig {
  // If the new fields are already present, trust them.
  if (raw.provider && raw.apiKey) {
    return {
      provider: raw.provider,
      apiKey: raw.apiKey,
      model: raw.model,
    };
  }
  // Legacy OpenRouter-only config -> upgrade.
  if (raw.openrouterApiKey || raw.openrouterModel) {
    return {
      provider: 'openrouter',
      apiKey: raw.openrouterApiKey,
      model: raw.openrouterModel,
    };
  }
  // Partial new-schema (e.g. provider set but no key yet).
  return {
    provider: raw.provider,
    apiKey: raw.apiKey,
    model: raw.model,
  };
}

export function readUserConfig(): UserConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as UserConfig & LegacyUserConfig;
    return migrate(parsed || {});
  } catch {
    // Corrupt file: return empty and let `cmdo init` rewrite it.
    return {};
  }
}

export async function writeUserConfig(cfg: UserConfig): Promise<void> {
  await fsp.mkdir(PATHS.root, { recursive: true });
  // Always persist in the v2 shape, regardless of what we read in.
  const out: UserConfig = {
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model: cfg.model,
  };
  // Pretty-print so users can eyeball / hand-edit the file.
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(out, null, 2), {
    encoding: 'utf8',
    // 0o600 on POSIX; Windows ignores but we still try for intent.
    mode: 0o600,
  });
}

// Resolution precedence (highest wins):
//   1. Process env vars (OPENAI_API_KEY / OPENROUTER_API_KEY + _MODEL)
//   2. ~/.commando/config.json (written by `cmdo init`)
//   3. Compiled-in defaults
//
// We pick the provider by looking at what's actually available - explicit
// config wins, otherwise whichever env var is set, otherwise 'openrouter'
// as a historical default.
export function getEffectiveLLM(): {
  provider: Provider;
  apiKey: string | undefined;
  model: string;
} {
  const cfg = readUserConfig();

  // Env var overrides for ad-hoc use (CI, one-off demos).
  const envOpenAI = process.env.OPENAI_API_KEY;
  const envOpenRouter = process.env.OPENROUTER_API_KEY;

  let provider: Provider;
  if (cfg.provider) {
    provider = cfg.provider;
  } else if (envOpenAI) {
    provider = 'openai';
  } else {
    provider = 'openrouter';
  }

  const apiKey =
    provider === 'openai'
      ? envOpenAI || cfg.apiKey
      : envOpenRouter || cfg.apiKey;

  const modelEnvOverride =
    provider === 'openai'
      ? process.env.OPENAI_MODEL
      : process.env.OPENROUTER_MODEL;

  const defaultModel =
    provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_OPENROUTER_MODEL;

  const model = modelEnvOverride || cfg.model || defaultModel;

  return { provider, apiKey, model };
}
