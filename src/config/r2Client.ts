import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { AUTH_STRATEGIES, MANIFEST_AUTH_KEY, AuthStrategy } from './defaults';

// Generic R2 helper. Tries each auth strategy in order until one yields a
// 2xx response. We cache the winning strategy per-process so we don't pay
// 2-3 failed round trips per subsequent call during a bootstrap.

let rememberedStrategy: AuthStrategy | null = null;

function applyStrategy(
  strategy: AuthStrategy,
  base: AxiosRequestConfig,
): AxiosRequestConfig {
  const headers: Record<string, string> = {
    ...(base.headers as Record<string, string> | undefined),
  };

  if (strategy.kind === 'bearer') {
    headers.Authorization = `Bearer ${MANIFEST_AUTH_KEY}`;
  } else {
    headers[strategy.name] = MANIFEST_AUTH_KEY;
  }

  return { ...base, headers };
}

// Authenticated GET with automatic strategy discovery. On first success we
// cache the winning strategy so every subsequent call uses it directly.
export async function authedGet(
  url: string,
  options: AxiosRequestConfig = {},
): Promise<AxiosResponse> {
  const strategies = rememberedStrategy
    ? [rememberedStrategy]
    : AUTH_STRATEGIES;

  let lastError: unknown;
  for (const strategy of strategies) {
    const config = applyStrategy(strategy, options);
    try {
      const res = await axios.get(url, {
        ...config,
        // Accept all statuses so we can inspect 401/403 ourselves.
        validateStatus: () => true,
      });
      // The worker returns 401 { error: "Unauthorized" } when the token is
      // missing/wrong, so anything 2xx (including 206 for Range responses)
      // means we've picked a working auth shape.
      if (res.status >= 200 && res.status < 300) {
        rememberedStrategy = strategy;
        return res;
      }
      // Non-2xx with a non-auth status (e.g. 404/5xx) means the endpoint
      // itself failed; retrying with another auth shape is pointless.
      if (res.status !== 401 && res.status !== 403) {
        return res;
      }
      lastError = new Error(
        `HTTP ${res.status} using auth=${strategy.kind}${
          'name' in strategy ? `:${strategy.name}` : ''
        }`,
      );
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('All auth strategies failed');
}

// Reset cache. Used by tests and by retry paths that detected stale auth.
export function resetAuthStrategyCache(): void {
  rememberedStrategy = null;
}
