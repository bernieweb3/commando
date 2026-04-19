import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions, sidebarOptions, showTabs, tabMode, explicitTabs } from '@/app/layout.config';
import { resolveIcon } from '@/lib/icons';
import { askAiEnabled } from '@/lib/ai-config';
import AiChatLoader from '@/components/ai/ai-chat-loader';

export default function Layout({ children }: { children: React.ReactNode }) {
  const options = baseOptions();

  // Resolve link icons at render time (icons are stored as strings in generated config)
  const resolvedLinks = options.links?.map((link: any) => {
    if (!link) return link;

    // Resolve icon on the link itself
    const resolved = link.icon && typeof link.icon === 'string'
      ? { ...link, icon: resolveIcon(link.icon) }
      : { ...link };

    // For menu items, also resolve icons on sub-items
    if (resolved.type === 'menu' && resolved.items) {
      resolved.items = resolved.items.map((item: any) =>
        item.icon && typeof item.icon === 'string'
          ? { ...item, icon: resolveIcon(item.icon) }
          : item
      );
    }

    return resolved;
  });

  // Resolve tabs: false (disabled), Option[] (explicit), or undefined (auto-detect from root folders)
  const tabsValue = !showTabs
    ? false
    : explicitTabs
      ? explicitTabs.map((t) => ({
          title: t.title,
          description: t.description,
          url: t.url,
          // `urls` lets Fumadocs mark the tab active for any page in the
          // tab, not just ones whose path starts with `url`. Required now
          // that `url` points at the first page instead of the tab folder.
          urls: t.urls && t.urls.length > 0 ? new Set(t.urls) : undefined,
          icon: t.icon ? resolveIcon(t.icon) : undefined,
          unlisted: t.unlisted,
        }))
      : undefined;

  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...options}
      links={resolvedLinks}
      sidebar={{
        ...sidebarOptions,
        tabs: tabsValue,
      }}
      tabMode={tabMode}
    >
      {askAiEnabled && <AiChatLoader />}
      {children}
    </DocsLayout>
  );
}
