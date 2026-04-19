'use client';
import { askAiEnabled } from '@/lib/ai-config';
import DefaultSearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { type ReactNode } from 'react';

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog: DefaultSearchDialog }}>
      {children}
    </RootProvider>
  );
}
