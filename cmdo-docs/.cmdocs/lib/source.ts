import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import type { InferPageType } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  plugins: [],
});

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, 'image.webp'];
  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}
