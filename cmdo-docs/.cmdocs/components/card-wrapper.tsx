"use client";

/**
 * Card wrapper that resolves string icon props to lucide-react components.
 *
 * Users write: <Card title="Encrypted" icon="lock">
 * This wrapper converts icon="lock" → icon={<Lock />} at runtime.
 *
 * Supports:
 * - icon="lock"  → lucide-react Lock icon
 * - icon="🔒"   → emoji rendered as-is
 * - icon={<MyIcon />} → JSX passed through
 */

import {
  Card as FumadocsCard,
  Cards,
} from "fumadocs-ui/components/card";
import type { HTMLAttributes, ReactNode } from "react";
import { resolveIcon } from "./icon-map";

type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  external?: boolean;
};

function Card({ icon, ...props }: CardProps) {
  return <FumadocsCard icon={icon ? resolveIcon(icon) : undefined} {...props} />;
}

export { Card, Cards };
