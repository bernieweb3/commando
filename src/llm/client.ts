import axios from 'axios';
import { PlannerError } from '../utils/errors';
import { getEffectiveLLM, Provider } from '../config/userConfig';

// Unified chat-completions wrapper that dispatches between OpenAI and
// OpenRouter. Both providers speak the same wire protocol (OpenAI's
// /v1/chat/completions), so the request body is identical - only the base
// URL and auth header differ. We keep this module dependency-free (no SDK)
// so the bundle stays small and the code path is easy to reason about.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  // Forces JSON-only output when the upstream model supports it. Models
  // that ignore this still usually produce valid JSON when the system
  // prompt demands it.
  responseFormatJson?: boolean;
}

interface ProviderEndpoint {
  url: string;
  // Additional headers beyond Authorization + Content-Type. OpenRouter
  // recommends attribution headers; OpenAI does not need any.
  extraHeaders?: Record<string, string>;
  // Human-friendly name used in error messages.
  label: string;
}

function endpointFor(provider: Provider): ProviderEndpoint {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      label: 'OpenAI',
    };
  }
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    label: 'OpenRouter',
    extraHeaders: {
      // Good-citizen attribution per OpenRouter docs.
      'HTTP-Referer': 'https://github.com/commando-cli',
      'X-Title': 'Commando CLI',
    },
  };
}

export async function chat(req: ChatRequest): Promise<string> {
  const { provider, apiKey, model } = getEffectiveLLM();
  const endpoint = endpointFor(provider);

  if (!apiKey) {
    throw new PlannerError(
      `${endpoint.label} API key is not configured`,
      'Run `cmdo init` to set it, export the matching *_API_KEY env var, or set CMDO_LLM_MOCK=1 for an offline demo.',
    );
  }

  try {
    const res = await axios.post(
      endpoint.url,
      {
        model: req.model || model,
        messages: req.messages,
        temperature: req.temperature ?? 0,
        ...(req.responseFormatJson
          ? { response_format: { type: 'json_object' } }
          : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(endpoint.extraHeaders || {}),
        },
        timeout: 30_000,
      },
    );
    const content: string | undefined =
      res.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new PlannerError(
        `${endpoint.label} returned an empty response.`,
        `raw response: ${JSON.stringify(res.data).slice(0, 500)}`,
      );
    }
    return content;
  } catch (err: unknown) {
    if (err instanceof PlannerError) throw err;
    // Surface the real upstream error. Both OpenAI and OpenRouter return a
    // JSON envelope like { "error": { "message": "...", "code": 404 } }
    // which is far more useful at demo time than a generic "request failed".
    const ax = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    const status = ax.response?.status;
    const body = ax.response?.data as
      | { error?: { message?: string; code?: number | string } }
      | undefined;
    const upstreamMsg =
      body?.error?.message ||
      (typeof ax.response?.data === 'string'
        ? (ax.response!.data as string)
        : undefined);
    const summary = status
      ? `HTTP ${status}${upstreamMsg ? ` - ${upstreamMsg}` : ''}`
      : ax.message || 'unknown network error';

    throw new PlannerError(
      `${endpoint.label} request failed: ${summary}`,
      'Verify the API key (run `cmdo init`), the model is still available, and you have credit. Use CMDO_LLM_MOCK=1 for offline demo.',
      err,
    );
  }
}
