import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import { seoConfig } from '@/lib/seo-config';
import type { Metadata } from 'next';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: seoConfig.baseUrl ? new URL(seoConfig.baseUrl) : undefined,
  title: {
    default: seoConfig.siteName,
    template: seoConfig.titleTemplate,
  },
  description: seoConfig.siteDescription,
  openGraph: {
    siteName: seoConfig.siteName,
    ...(seoConfig.ogImage ? {
      images: [{ url: seoConfig.ogImage, width: 1200, height: 630 }],
    } : {}),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}

