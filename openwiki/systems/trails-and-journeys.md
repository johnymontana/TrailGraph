---
type: trails and journeys system
title: Hiking trails and cross-park journeys
description: Real trail search, Blob geometry and elevation ingestion, loop topology and planner links, plus distinct person/topic thematic journeys and tours.
tags: [trails, journeys, gis, trips]
---
# Hiking trails and cross-park journeys

`/trails` is real hikeable trails; `/journeys` is the separate cross-park thematic feature. `next.config.ts` redirects only legacy thematic `/trails?person=`, `/trails?topic=`, and `/trails/tour` URLs. This separation prevents route compatibility from changing the semantics of a hiking finder.

## Trails: query, detail, and storage

`searchTrails()` in `lib/queries.ts` supports park/region/text, difficulty ceiling, length/gain, route/use/dogs/accessibility/permit/surface/activity/topic filters and pagination. A max difficulty excludes unknown difficulty—unknown cannot truthfully satisfy a ceiling. `trailDetail()` joins Park, trailheads, nearby services and curated ThingToDo but geometry/profile load separately through `readParkTrails()` from `Park.trailsGeoUrl`. Detail gives explicit no-geometry/no-profile fallbacks.

Sync fetches GIS centerlines, aggregates named trails, hashes, writes FeatureCollection to Blob/local dev, upserts metadata and stores pointer. Equal hash skips only with a live pointer. Elevation resamples each line segment, batches provider calls, and on 429 stops for later resume rather than writing partial grade; profile and scalar gains/difficulty are written both Blob and graph. This is the graph/Blob split described in [data platform](../architecture/data-platform.md).

`computeConnections()` produces one `CONNECTS {junctions}` edge per unordered trail pair with distinct shared endpoints. Rebuild deletes a park’s old network only after successfully reading that park Blob file. `suggestLoops()` returns either a declared single loop or a connected pair with at least two junctions, summarized with Naismith time. Stops can include trails via `INCLUDES_TRAIL`; day load includes their estimated time.

## Journeys and tour

A journey is either `Person-[:ASSOCIATED_WITH]->Park` or `Park-[:HAS_TOPIC]->Topic`. `journeyThemes()` selects people with 2+ and topics with 3+ parks; `journeyTrail()` resolves an optional person/topic, and `/journeys` links selected parks to graph and tour. `/journeys/tour` filters mappable parks, loads up to one related lesson per stop, and drives `StoryTour`; optional terrain falls back to flat pitched camera movement. Trail detail cross-links to lessons, people and topics at its park.

Run `loop-builder.test.ts`, `trail-network.test.ts`, sync/elevation tests; guarded `trails.itest.ts`, `trails-plan.itest.ts`, `trail-elevation.itest.ts`; Playwright `trails.spec.ts` and `trail-tour.spec.ts`. Modify ingest hash/pointer behavior and geometry consumers together; never make missing geometry a failed park page.