// Legacy module path retained so downstream imports keep working after the
// v2 refactor that added OpenAI support. All logic now lives in client.ts,
// which dispatches between OpenAI and OpenRouter based on user config.
export { chat, ChatMessage, ChatRequest } from './client';
