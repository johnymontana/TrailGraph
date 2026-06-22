import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Provider } from './provider';
import { SiteNav } from '../components/SiteNav';

export const metadata: Metadata = {
  title: 'TrailGraph',
  description: 'Explore and plan trips to the U.S. National Parks — with a graph-native memory.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>
          <SiteNav />
          {children}
        </Provider>
      </body>
    </html>
  );
}
