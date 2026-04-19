// Defaults shipped with the Commando package.
//
// IMPORTANT: nothing in this file is allowed to contain a real secret. We
// historically hardcoded an R2 manifest auth token here, but that token
// shipped inside the published npm tarball and was therefore world-readable.
// Starting with 0.2.4-beta we removed it: the canonical install path on every
// platform is now a direct GitHub release download (see
// `bootstrap/download-gh.ts`), and the optional R2 manifest path is gated
// behind operator-supplied env vars:
//
//   CMDO_MANIFEST_URL  - full URL to the manifest JSON in R2 (or any
//                        compatible mirror). Empty/unset => R2 path disabled.
//   CMDO_R2_TOKEN      - bearer/header token the worker accepts. Empty/unset
//                        => R2 path disabled (we will NOT prompt the user).
//
// When either var is missing, Windows installs transparently fall through to
// the same GitHub-direct flow used on Linux/macOS. This keeps the "no user
// prompts" UX intact for the 99% case while letting operators (CI mirrors,
// air-gapped enterprise, future paid tiers) opt back into R2 with provenance.

export const MANIFEST_URL: string = process.env.CMDO_MANIFEST_URL ?? '';

export const MANIFEST_AUTH_KEY: string = process.env.CMDO_R2_TOKEN ?? '';

// True only when the operator has explicitly configured BOTH halves of the
// R2 path. Anything else => skip R2 and use GitHub-direct.
export function isR2Configured(): boolean {
  return MANIFEST_URL.length > 0 && MANIFEST_AUTH_KEY.length > 0;
}

// Ordered list of auth strategies the r2-worker accepts. See
// r2-worker/src/index.js `isAuthorized()` for the source of truth. We list
// Bearer first because it's the canonical form in the worker README and is
// almost always the winning strategy, so the cache in r2Client.ts hits on
// the first try.
export const AUTH_STRATEGIES = [
  { kind: 'bearer' as const }, // Authorization: Bearer <token>
  { kind: 'header' as const, name: 'x-custom-auth-key' },
  { kind: 'header' as const, name: 'x-upload-token' }, // legacy, kept for worker backcompat
];

export type AuthStrategy = (typeof AUTH_STRATEGIES)[number];

// Default OpenRouter model used if the user didn't run `cmdo init` but still
// set OPENROUTER_API_KEY via env. Kept in sync with the previous codebase.
export const DEFAULT_OPENROUTER_MODEL = 'z-ai/glm-4.5-air:free';

// Curated OpenAI models offered in the `cmdo init` dropdown. We keep this
// list tight (6 entries) so the interactive picker stays a one-screen
// decision; power users can still override via OPENAI_MODEL env var.
// Update here when OpenAI ships or deprecates a model - no code change
// elsewhere is required.
export const OPENAI_MODELS = [
  { id: 'gpt-4o', label: 'gpt-4o', note: 'flagship, best for complex plans' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', note: 'cheap + fast, good default' },
  { id: 'gpt-4.1', label: 'gpt-4.1', note: 'next-gen flagship' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', note: 'smaller 4.1 tier' },
  { id: 'o3-mini', label: 'o3-mini', note: 'reasoning model' },
  { id: 'o4-mini', label: 'o4-mini', note: 'newer reasoning model' },
] as const;

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
