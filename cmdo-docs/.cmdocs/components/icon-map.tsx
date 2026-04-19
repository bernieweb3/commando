"use client";

/**
 * Icon resolution for Card components.
 *
 * Resolves string icon props to lucide-react components at runtime.
 * Uses lucide-react's built-in `icons` object for dynamic lookup.
 *
 * Supports:
 * - Lucide icon names (PascalCase): icon="Lock", icon="Sun"
 * - Emoji: icon="🔒"
 * - Text fallback: icon="AB"
 * - JSX passthrough: icon={<MyIcon />}
 */

import { icons } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Resolve an icon prop value to a ReactNode.
 *
 * - PascalCase lucide name → lucide-react component (e.g. "Lock" → <Lock />)
 * - Emoji or text → rendered as-is
 * - ReactNode (JSX) → passed through
 */
export function resolveIcon(icon: ReactNode): ReactNode {
  if (typeof icon !== "string") return icon;

  const Icon = icons[icon as keyof typeof icons];
  if (Icon) return <Icon />;

  // Emoji or unknown text — render as-is
  return icon;
}
