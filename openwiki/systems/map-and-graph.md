---
type: map and graph system
title: Map, graph exploration, offline packs, and basemap assets
description: MapLibre state and bounded APIs, NVL graph exploration and privacy, offline-area artifacts, and PMTiles/glyph asset lifecycle.
tags: [map, graph, maplibre, nvl, offline]
---
# Map, graph exploration, offline packs, and basemap assets

`app/map/page.tsx` builds initial map props and mounts `components/MapExplorer.tsx`; `app/graph/page.tsx` mounts NVL constellation components. Both read Neo4j-derived views but keep expensive/public client requests bounded. `RangerCommandBar` hands map focus to the map event surface rather than letting agent tools mutate browser state directly.

## Map state and domain BFF

`lib/map-deeplink.ts` encodes/decodes camera, topo/dark basemap, layers, lens, ISO conditions date and all/mine mode. It only emits finite lat+lng together, quantizes coordinates/zoom, omits defaults, allowlists every enum and drops invalid values. `app/api/graph/route.ts` is the read-only map/domain BFF despite its name: parks-all, near, bbox/layers, connections, facet codes, bounded conditions, vibe embedding search and faceted search. Conditions/vibe require minimum input and are IP 20/minute; conditions caps viewport parks at 40.

## Graph contracts

`graphSeed()` builds a readable National Park topic backbone—not a complete hairball—using distinctive IDF topic similarity, top-K/caps/connectivity floor while preserving isolates. `expandNode()` only interpolates labels from `GRAPH_NODE_KEYS`; it emits one-hop deduplicated directed relationships and ignores inactive alerts. `graphLens()` allowlists topic/activity/near/person/tour/co-considered relationships. Co-consideration is aggregate-only and enforces `minUsers >= 5`.

`POST /api/graph/query` validates JSON and a minimum query length, limits IP requests, and passes failures through the shared server error response. It selects only typed, curated `INTENTS` in `lib/graph-intents.ts`, resolves park names through normal search, then returns narration plus NVL-ready nodes/links: it never executes caller-provided Cypher. `topicalPath()` permits only materialized `SHARES_TOPIC`, `SHARES_ACTIVITY`, and `NEAR` traversal, bounded to six hops, with same-park handling. `drivingPath()` uses GDS Dijkstra on the parks-near projection and falls back to topical when projection or route is absent, with degraded narration. `graphTripPath()` chains selected parks in order, adds marked synthetic direct links for disconnected consecutive pairs, deduplicates links, and reports distance totals only where component distances exist.

## Offline pack and asset lifecycle

`/api/map/offline` produces an area ZIP from validated viewport/layer inputs: printable field sheet, JSON/GeoJSON, NPS boundaries and Blob-backed trail geometry when available. It is public but IP-rate-limited; `lib/area-pack.ts` bounds its workload (60 parks, 15 boundaries, 400 POIs) and truncates rather than allowing an unbounded viewport export. Keep output honest about missing Blob geometry.

`pnpm build:basemap` (`scripts/build-basemap.ts`) creates a bounded PMTiles extract; `pnpm build:glyphs` regenerates committed self-hosted glyphs; `pnpm basemap:upload` uploads and verifies Range `206`. `lib/mapStyle.ts` registers PMTiles, rejects private/signed Blob URLs unsuitable for range reads, and falls back to demo tiles when source fails. Production uses public Blob URL in `NEXT_PUBLIC_MAP_TILES_URL`; optional terrain/glyph URLs are public browser configuration and their hosts must be in both CSP image/connect sources in `next.config.ts`.

## Change and test surface

For a map field, update codec/type/default omission, server validation, client control and test. For a graph type/lens, update closed label/lens maps, query, API validation, NVL mapping and privacy review. For offline changes, update route + `area-pack.ts` artifact contract and retain caps/rate limit. For asset changes, update build/upload/style/CSP config together.

Focused proof: `map-deeplink.test.ts`, `mapLenses.test.ts`, `mapStyle.test.ts`, `conditions-map.test.ts`, `graph-backbone.test.ts`, `graph-query.test.ts`, `graph-nvl.test.ts`, and **offline/geometry lifecycle evidence** `area-pack.test.ts`, `tests/e2e/map-offline.spec.ts`, `sync/sync-trails.test.ts`, `sync/derive-trail-elevation.test.ts`. Use guarded `map-queries.itest.ts`, graph integration suites, then map/graph Playwright specs.