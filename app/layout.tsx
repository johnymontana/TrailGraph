import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Bricolage_Grotesque, Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { Provider } from './provider';
import { SiteNav } from '../components/SiteNav';
import { SiteFooter } from '../components/SiteFooter';
import { Toaster } from '../components/ui/toaster';
import { MemoryFormingLayer } from '../components/memory/MemoryFormingLayer';

// Display font (headings, wordmark) + body/UI font, exposed as CSS variables that the Chakra `fonts`
// tokens reference (theme/tokens.ts). `display: 'swap'` avoids a blocking font fetch.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'TrailGraph — Explore the U.S. National Parks',
    template: '%s · TrailGraph',
  },
  description:
    'Explore and plan trips to the U.S. National Parks — a connected graph with an AI ranger that remembers what you love.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable}`}>
      <body>
        <Provider>
          <SiteNav />
          {children}
          {/* Server-rendered footer; hidden on full-screen routes via the `:has([data-fullscreen])`
              global rule (theme/index.ts) — no client gate, so no SSR/CSR hydration drift. */}
          <SiteFooter />
          <Toaster />
          {/* Plays the "memory forming" animation when a bridge is persisted (ADR-044 §7.2). Renders
              nothing until a `trailgraph:memory-formed` event fires, so it never affects first paint. */}
          <MemoryFormingLayer />
          <Analytics />
        </Provider>
      </body>
    </html>
  );
}
