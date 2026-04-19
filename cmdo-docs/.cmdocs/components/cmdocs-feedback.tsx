'use client';

import { Feedback } from '@/components/feedback/client';
import type { PageFeedback, ActionResponse } from '@/components/feedback/schema';

/**
 * Thin wrapper around Fumadocs' scaffolded <Feedback> that wires
 * `onSendAction` to `window.cmdocs.trackFeedback()` — the analytics
 * ingest endpoint injected at build time by build-core's analytics transform.
 *
 * Works in static export (no server actions needed).
 */
export function CmdocsFeedback() {
  return <Feedback onSendAction={sendFeedback} />;
}

async function sendFeedback(feedback: PageFeedback): Promise<ActionResponse> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmdocs = (window as any).cmdocs;
    if (cmdocs?.trackFeedback) {
      cmdocs.trackFeedback(
        feedback.url,
        feedback.opinion === 'good' ? 1 : -1,
        feedback.message || null,
      );
    }
  } catch {
    // analytics script not loaded — no-op (e.g. local dev)
  }
  return {};
}
