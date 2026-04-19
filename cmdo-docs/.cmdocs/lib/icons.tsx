import * as LucideIcons from 'lucide-react';
import { createElement, type ReactNode } from 'react';

/**
 * Resolve an icon string to a React node.
 *
 * - If the string matches a Lucide icon export name (e.g. "BookOpen") → render the Lucide component
 * - Otherwise treat as emoji text (e.g. "📚") → render as a span
 *
 * Note: Lucide icons are React.forwardRef components (objects with $$typeof),
 * not plain functions. We check for both to be safe.
 */
export function resolveIcon(name: string, className = 'size-4'): ReactNode {
  const Icon = (LucideIcons as Record<string, any>)[name];
  if (Icon && (typeof Icon === 'function' || Icon.$$typeof)) {
    return createElement(Icon, { className });
  }
  // Treat as emoji or text
  return createElement('span', null, name);
}
