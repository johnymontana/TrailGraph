'use client';
import { usePathname } from 'next/navigation';
import { SiteFooter } from './SiteFooter';

// The full-screen, position:fixed routes (map/graph/plan) own the whole viewport below the 57px nav, so a
// document-flow footer there would sit behind the overlay and add a stray scroll region. Hide it on those.
const FULLSCREEN = ['/map', '/graph', '/plan'];

export function FooterGate() {
  const pathname = usePathname();
  if (FULLSCREEN.some((h) => pathname === h || pathname.startsWith(`${h}/`))) return null;
  return <SiteFooter />;
}
