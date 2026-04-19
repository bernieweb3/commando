import { getToolContext, ToolContext } from '../skills/loader';

// The router picks which tool the user *probably* wants, using (in order):
//   1. Explicit flags: --sui | --walrus | --site-builder (hard override).
//   2. Keyword inference over the natural-language prompt.
//   3. Safe default: "sui" (the most common entrypoint for the Sui stack).

export type Tool = 'sui' | 'walrus' | 'site-builder';

export interface IntentFlags {
  sui?: boolean;
  walrus?: boolean;
  siteBuilder?: boolean;
}

export interface RoutedIntent {
  tool: Tool;
  context: ToolContext;
  reason: 'flag' | 'keyword' | 'default';
}

// Keyword -> tool mapping. Ordered from most specific to least specific so
// that e.g. "upload a site" resolves to site-builder, not walrus.
//
// A few non-obvious choices worth noting:
//   - "contract", "build", "test", "compile", "deploy" route to sui
//     because the Move/package workflow is a sui subcommand tree (sui
//     move build, sui move test, sui client publish). If we let these
//     fall through to the "sui" bucket via the default branch, they'd
//     also work, but then users would see `routed to "sui" (default)`
//     which looks random; surfacing the keyword match makes logs
//     explainable for the demo.
//   - "upload" lives in BOTH walrus (raw blob) and site-builder (static
//     site). We put it in walrus here and rely on explicit "--site-
//     builder" flag + "site"/"sitemap" keywords above to disambiguate.
const KEYWORDS: { tool: Tool; words: RegExp }[] = [
  { tool: 'site-builder', words: /\b(sites?|sitemaps?|deploy\s+site|walrus.?sites?|publish\s+site|static\s+site)\b/i },
  { tool: 'walrus', words: /\b(walrus|blobs?|aggregators?|publishers?|store\s+files?|quilts?|get.?wal|staked?.?wal|epoch)\b/i },
  {
    tool: 'sui',
    words:
      /\b(sui|move|publish|deploy|contracts?|packages?|modules?|compile|build|tests?|unit.?tests?|scaffold|new.?package|addresses?|keytool|gas|faucet|coins?|objects?|transactions?|tx|switch.*\b(testnet|devnet|mainnet|localnet)\b|new.?address|transfer)\b/i,
  },
];

export function routeIntent(
  prompt: string,
  flags: IntentFlags = {},
): RoutedIntent {
  // 1. explicit flag wins
  if (flags.sui) return finalize('sui', 'flag');
  if (flags.walrus) return finalize('walrus', 'flag');
  if (flags.siteBuilder) return finalize('site-builder', 'flag');

  // 2. keyword inference
  for (const k of KEYWORDS) {
    if (k.words.test(prompt)) return finalize(k.tool, 'keyword');
  }

  // 3. default
  return finalize('sui', 'default');
}

function finalize(tool: Tool, reason: RoutedIntent['reason']): RoutedIntent {
  return { tool, context: getToolContext(tool), reason };
}
