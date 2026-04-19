import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(
  _req: Request,
  props: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await props.params;

  // Strip .md extension from the last segment to look up the actual page
  const cleanSlug = slug.map((s, i) =>
    i === slug.length - 1 ? s.replace(/\.md$/, '') : s
  );

  const page = source.getPage(cleanSlug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: { 'Content-Type': 'text/markdown' },
  });
}

export function generateStaticParams() {
  // Append .md to the last slug segment to avoid directory/file conflicts
  // during Next.js static export (e.g. "documentation" can't be both a file
  // and a directory when "documentation/quickstart" also exists)
  return source.generateParams()
    .filter((p) => p.slug.length > 0)
    .map((p) => ({
      slug: p.slug.map((s, i) =>
        i === p.slug.length - 1 ? `${s}.md` : s
      ),
    }));
}
