import { source, getPageImage } from '@/lib/source';
import { seoConfig } from '@/lib/seo-config';
import { pageDisplayOptions, rootRedirect } from '@/app/layout.config';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { MarkdownCopyButton, ViewOptionsPopover } from '@/components/ai/page-actions';
import { CmdocsFeedback } from '@/components/cmdocs-feedback';
import type { Metadata } from 'next';

/**
 * Client-side redirect component for static export.
 * Next.js redirect() doesn't work with `output: 'export'` — it needs to
 * generate an actual HTML file. This renders a page with both meta refresh
 * and JS redirect for maximum compatibility.
 */
function RedirectPage({ to }: { to: string }) {
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${to}`} />
      <script dangerouslySetInnerHTML={{ __html: `window.location.replace("${to}")` }} />
      <p>Redirecting to <a href={to}>{to}</a>...</p>
    </>
  );
}

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;

  // Root redirect: when multi-tab, / has no content → redirect to first tab.
  // Cover both `undefined` (direct navigation) and `[]` (static export param).
  if ((!params.slug || params.slug.length === 0) && rootRedirect) {
    return <RedirectPage to={rootRedirect} />;
  }

  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      tableOfContent={{ enabled: pageDisplayOptions.toc.enabled, style: pageDisplayOptions.toc.style }}
      breadcrumb={{ enabled: pageDisplayOptions.breadcrumb }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pt-2 pb-6">
        <MarkdownCopyButton markdownUrl={`/llms-mdx${page.url}.md`} />
        <ViewOptionsPopover markdownUrl={`/llms-mdx${page.url}.md`} />
      </div>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      <CmdocsFeedback />
      {pageDisplayOptions.lastUpdated && 'lastModified' in page.data && page.data.lastModified ? (
        <p className="text-sm text-fd-muted-foreground mt-8">
          Last updated: {new Date(page.data.lastModified as string | number).toLocaleDateString()}
        </p>
      ) : null}
    </DocsPage>
  );
}

export async function generateStaticParams() {
  const params = source.generateParams();

  // For optional catch-all routes under `output: 'export'`, Next.js only emits
  // an `index.html` for the root path if we explicitly include a param entry
  // for the empty slug. Multi-tab docs ship with no top-level page, so without
  // this the router would get a 404 when hitting the bare subdomain.
  const hasRoot = params.some((p) => !p.slug || p.slug.length === 0);
  if (!hasRoot) {
    return [{ slug: [] as string[] }, ...params];
  }
  return params;
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;

  // Root-redirect placeholder page has no backing MDX — emit minimal metadata
  // that matches what the redirecting shell will actually render.
  if ((!params.slug || params.slug.length === 0) && rootRedirect) {
    return {
      title: seoConfig.siteName,
      description: seoConfig.siteDescription,
      robots: { index: false, follow: false },
    };
  }

  const page = source.getPage(params.slug);
  if (!page) notFound();

  const ogImage = getPageImage(page);

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      type: 'article',
      url: `${seoConfig.baseUrl}${page.url}`,
      images: ogImage.url,
      siteName: seoConfig.siteName,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: ogImage.url,
    },
    ...(seoConfig.canonical && {
      alternates: { canonical: `${seoConfig.baseUrl}${page.url}` },
    }),
  };
}

