'use client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
  type SearchItemType,
} from 'fumadocs-ui/components/dialog/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { create } from '@orama/orama';
import { useI18n } from 'fumadocs-ui/contexts/i18n';

function initOrama() {
  return create({
    schema: { _: 'string' },
    language: 'english',
  });
}

export default function DefaultSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const { search, setSearch, query } = useDocsSearch({
    type: 'static',
    initOrama,
    locale,
  });

  // Track search result clicks via cmdocs analytics (injected at build time)
  const handleSelect = (item: SearchItemType) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cmdocs = (window as any).cmdocs;
      if (cmdocs?.trackSearch && 'url' in item) {
        const resultsCount = Array.isArray(query.data) ? query.data.length : 0;
        cmdocs.trackSearch(search, resultsCount, item.url);
      }
    } catch {
      // analytics not loaded — no-op
    }
  };

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} onSelect={handleSelect} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
