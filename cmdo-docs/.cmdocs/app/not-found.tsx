import Link from 'next/link';
import type { Metadata } from 'next';
import { rootRedirect } from '@/app/layout.config';
import { seoConfig } from '@/lib/seo-config';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  const homeHref = rootRedirect ?? '/';
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-fd-muted-foreground text-sm font-medium uppercase tracking-wider">
        404
      </p>
      <h1 className="mt-2 text-3xl font-bold text-fd-foreground sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-fd-muted-foreground">
        The page you are looking for does not exist in {seoConfig.siteName}.
        It may have been moved, renamed, or removed.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href={homeHref}
          className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Go to home
        </Link>
      </div>
    </main>
  );
}
