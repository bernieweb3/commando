'use client';

import dynamic from 'next/dynamic';

// Load AI components only on the client — useChat hooks crash during SSR/static export
const AiChatBlockInner = dynamic(
  () => import('@/components/ai/ai-chat-block'),
  { ssr: false }
);

/**
 * Client-side wrapper that uses dynamic import with ssr:false.
 * Must be a Client Component because next/dynamic({ssr:false}) is not allowed in Server Components.
 */
export default function AiChatLoader() {
  return <AiChatBlockInner />;
}
