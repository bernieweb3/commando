'use client';

import { AISearch, AISearchPanel, AISearchTrigger } from '@/components/ai/search';
import { buttonVariants } from '@/components/ui/button';
import { MessageCircleIcon } from 'lucide-react';

/**
 * Client-only wrapper for the Fumadocs AI chat components.
 * Loaded via dynamic(..., { ssr: false }) to avoid SSR issues with useChat hooks.
 */
export default function AiChatBlock() {
  return (
    <AISearch>
      <AISearchPanel />
      <AISearchTrigger
        position="float"
        className={buttonVariants({
          color: 'secondary',
          className: 'rounded-2xl gap-1.5 shadow-lg',
        })}
      >
        <MessageCircleIcon className="size-4" />
        Ask AI
      </AISearchTrigger>
    </AISearch>
  );
}

