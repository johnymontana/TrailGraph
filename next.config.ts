import type { NextConfig } from 'next';
import { withEve } from 'eve/next';

/**
 * withEve runs the eve agent as a service behind the Next app: in dev it auto-starts `eve dev` and
 * proxies it under a same-origin prefix, so the browser's Better Auth cookie reaches the eve channel
 * (betterAuthAuth identifies the user — R4). One command, `pnpm dev`, runs both.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ['neo4j-driver', '@neo4j-labs/agent-memory'],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
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
