---
type: operations and testing guide
title: Runtime operations, configuration, and testing
description: Development and Vercel composition, lazy configuration and feature degradation, authenticated scheduled jobs, build assets, security policy, and validation layers.
tags: [operations, testing, deployment, configuration]
---
# Runtime operations, configuration, and testing

Node 20+ and pnpm run this single Next application. `pnpm dev` uses webpack and `withEve` starts/proxies the ranger; `DISABLE_EVE=1 pnpm dev` is intentional UI-only operation. Production remains `next build`/`next start`: Eve is deployed with the app, not separately. See [architecture](architecture/overview.md).

## Configuration ownership and degradation

`lib/env.ts` reads configuration lazily at consuming surfaces rather than requiring all integrations for all routes. Server-only credentials include Neo4j, NPS, NAMS, auth/email, ORS, RIDB and elevation; `NEXT_PUBLIC_*` map tile/glyph/terrain settings are browser-visible and must never contain secrets. Feature flags isolate costly or optional work: trails/elevation, embeddings, multimedia, lesson decomposition, federation/OSM and live campsite availability. Missing optional config must yield feature-off behavior (for example availability unavailable, terrain flat, demo map fallback), not application failure. Embedding dimension assumptions must remain compatible with existing 1536-dimension vector schema.

## Scheduled work and failure behavior

`vercel.json` defines four schedules: `08:00 UTC /api/sync?tier=all`, `08:30 /api/memory/reconcile`, `12:00 /api/digests`, and every 15 minutes `/api/camp-watch`. Cron handlers require Bearer `CRON_SECRET` through `lib/cron-auth.ts`; do not expose a less restrictive route when adding a job.

Sync persists `SyncState`, partial cursors and counts, writes each page before progressing, uses freshness skips, retries ordinary failures and marks rate-limit work paused for resume. See [data platform](architecture/data-platform.md). Digest and camp-watch fan-outs are bounded, honor email opt-in/configuration and isolate provider/email errors; camp watches retain snapshots/mutes and expire obsolete dates. These jobs are not transactional all-user mail guarantees.

## Map/build assets and security

Build map assets with `pnpm build:basemap`, `pnpm build:glyphs`, and optional `pnpm basemap:upload`; public Blob PMTiles URL must support ranges. Blob is required in production for map/trail geometry but local fallback is development-only. A new browser tile/terrain/glyph host needs both `img-src` and `connect-src` CSP entries. `next.config.ts` currently ships CSP report-only, anti-framing/nosniff/referrer/permissions headers, production-only HSTS, image host allowlist and NVL-specific `reactStrictMode: false`; preserve these reasons when changing framework configuration.

## Validation ladder

| Scope | Command | Notes |
|---|---|---|
| static | `pnpm typecheck` | narrow first gate |
| pure logic | `pnpm test:unit` | `lib/**/*.test.ts`, mocked I/O |
| graph behavior | `RUN_INTEGRATION=1 pnpm test:integration` | isolated reachable Neo4j; sequential project |
| browser product | `pnpm test:e2e` | production build/start, seeded Neo4j, Eve disabled |
| schema | `pnpm db:migrate && pnpm db:verify` | idempotent migrations, isolated DB |

`playwright.config.ts` deliberately builds production because Chakra/Emotion dev hydration signals are false positives; CI uses one worker for graph contention and SwiftShader for MapLibre. Run the focused unit/integration/e2e suite named on the affected system page before broad checks. Change surfaces: config additions need `env.ts`, sample placeholder config, consuming fallback and docs; cron additions need route auth, `vercel.json`, bounded failure tests; asset changes need script/style/CSP/e2e coverage.