import type { NextConfig } from 'next';
import { withEve } from 'eve/next';

/**
 * withEve runs the eve agent as a service behind the Next app: in dev it auto-starts `eve dev` and
 * proxies it under a same-origin prefix, so the browser's Better Auth cookie reaches the eve channel
 * (betterAuthAuth identifies the user — R4). One command, `pnpm dev`, runs both.
 */
// Content-Security-Policy tuned to the app's real browser origins (audit S1): NPS images, Vercel Blob
// pmtiles, Protomaps glyphs, the MapLibre demo-tile fallback, MapLibre GL workers (blob:). The agent
// chat streams same-origin (/eve/v1 via withEve); NPS/ORS/NAMS/AI-Gateway are server-side only, so they
// don't belong in the browser connect-src. Emotion/Chakra + next-themes need inline styles/scripts.
//
// Shipped as Content-Security-Policy-Report-Only first: validate /, /map, /graph, /plan, /search, and a
// chat session in the browser console (no violations), then rename the header key to
// 'Content-Security-Policy' to enforce.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.nps.gov https://*.public.blob.vercel-storage.com",
  "connect-src 'self' https://*.public.blob.vercel-storage.com https://demotiles.maplibre.org https://protomaps.github.io",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  // Flip to 'Content-Security-Policy' to enforce after validating in Report-Only.
  { key: 'Content-Security-Policy-Report-Only', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
  // includeSubDomains + preload is a commitment: every *.trailgraph.app must be HTTPS-only.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // stop leaking "X-Powered-By: Next.js"
  serverExternalPackages: ['neo4j-driver', '@neo4j-labs/agent-memory'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Optimize/resize NPS images through next/image instead of hotlinking full-res originals (§8).
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.nps.gov' },
      { protocol: 'https', hostname: '**.nps.gov' },
    ],
  },
};

// DISABLE_EVE=1 runs Next without auto-starting the eve service — used by the e2e job (public-surface
// tests need no agent / AI Gateway) and any context where you want the app without the ranger.
export default process.env.DISABLE_EVE === '1' ? nextConfig : withEve(nextConfig);
