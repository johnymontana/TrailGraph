---
type: wiki entrypoint
title: TrailGraph code wiki
description: Navigate TrailGraph's Next.js product, Neo4j graph, Eve ranger, data pipelines, and focused change paths.
tags: [trailgraph, navigation, architecture]
---
# TrailGraph code wiki

TrailGraph is a Next.js national-park explorer, planner, map and learning product. Its key architectural bet is one Neo4j instance containing the NPS domain graph, application data and NAMS context graph, so the Eve Ranger and ordinary UI can use the same canonical preference-to-park relationships.

## Start with the map

- [Architecture overview](architecture/overview.md) — runtime composition, ownership boundaries and cross-system flows.
- [Neo4j schema and data lifecycle](architecture/data-platform.md) — migrations, NPS sync, external sources, derived graph and Blob split.
- [Runtime operations, configuration, and testing](operations-and-testing.md) — commands, deployment, flags, crons, security and validation.

## Product systems

| System | What it owns | Canonical page |
|---|---|---|
| Ranger and context graph | Eve channel/tools, auth identity, NAMS, deterministic prompt memory, bridges/reconcile | [Ranger agent and context memory](systems/ranger-memory.md) |
| Discovery | Explore/search/park pages, graph facts, live weather/roads/hours | [Explore, search, park detail, and conditions](systems/discovery.md) |
| Itineraries | personal trips, Stops, routing, day plans, shares and exports | [Trip planner, routing, sharing, and exports](systems/trip-planning.md) |
| Camp stays | finder/detail/compare, RIDB federation, booking/availability, watches | [Campgrounds, availability, and watches](systems/campgrounds.md) |
| Interactive geography | MapLibre/NVL, graph APIs/lenses, offline ZIPs, PMTiles | [Map, graph exploration, offline packs, and basemap assets](systems/map-and-graph.md) |
| Outdoors and themes | real trail GIS/network/elevation and separate journeys/tour | [Hiking trails and cross-park journeys](systems/trails-and-journeys.md) |
| Learning and engagement | Ranger School, personal hub, collective/readings, digest/inbox | [Ranger School, personal engagement, and notifications](systems/learning-and-engagement.md) |

## Route a change quickly

| Intent | Source owners / symbols | Focused validation |
|---|---|---|
| Add NPS resource or graph field | `lib/sync/index.ts`, `lib/sync/upserts.ts`, `db/migrations/`, `lib/queries.ts` | transform test + `pnpm db:migrate && pnpm db:verify`; guarded NPS integration |
| Change agent tool or memory | `agent/tools/`, `lib/agent-ctx.ts`, `lib/bridges.ts`, `lib/memory-graph.ts` | memory/bridge unit tests; `agent-memory-block.itest.ts` |
| Change search/filter/park fact | `lib/queries.ts`, appropriate `app/*/page.tsx` | `queries.test.ts`, feature integration and relevant Playwright |
| Change itinerary mutation/route | `lib/validation.ts`, `app/api/trips/[id]/route.ts`, `lib/trips.ts` | trips/routing/itinerary tests + `trips.itest.ts` |
| Change recommendation/ranking | `lib/recommend.ts`, graph recommendation route, bridge/explain consumers | `recommend.test.ts` + recommendation integration |
| Change camps/availability | `lib/campgrounds.ts`, `datasources/campAvailability.ts`, camp route/page | camp unit tests + `campgrounds.itest.ts` / `campgrounds.spec.ts` |
| Change map/graph/offline export | `MapExplorer.tsx`, `map-deeplink.ts`, `app/api/graph`, `area-pack.ts` | map/graph tests + `map-offline.spec.ts` |
| Change trails/GIS | `sync-trails.ts`, elevation/network modules, Blob adapter | trail sync/elevation tests + trail integration |
| Add a scheduled integration/config | `lib/env.ts`, cron route, `vercel.json`, `next.config.ts` | targeted config/cron tests, `pnpm typecheck` |

## Local checks

```bash
pnpm typecheck
pnpm test:unit
RUN_INTEGRATION=1 pnpm test:integration
pnpm test:e2e
```

Integration and E2E require an isolated/seeded Neo4j; E2E builds production and starts without Eve. Use the narrower test paths recorded on each system page before these broad checks.

## Scope and safety

The wiki covers every substantial application service and public route family. Treat live NPS/Recreation.gov/weather data as advisory and preserve existing unknown/fallback semantics. Never weaken owner-scoped trip/memory access, canonical vocabulary checks, public endpoint bounds, or cron authorization to simplify an extension.extension.