# TrailGraph

Explore and plan trips to the U.S. National Parks, backed by a **single Neo4j** holding both the
NPS **domain graph** and a per-user **context graph** (memory), with an Eve-powered AI ranger.

Design rationale lives in [`docs/DECISIONS.md`](docs/DECISIONS.md) (ADR log) and
[`docs/GLOSSARY.md`](docs/GLOSSARY.md). NAMS feedback gathered during the build is in
[`docs/NAMS-FEEDBACK.md`](docs/NAMS-FEEDBACK.md). Working conventions and the must-know gotchas (Neo4j
driver integers, Chakra/Emotion SSR, Eve model id, test gates) are in [`CLAUDE.md`](CLAUDE.md).

## Stack
Next.js (App Router) · Neo4j · NAMS (hosted, external Neo4j) · Eve · Better Auth (magic link) ·
MapLibre GL · OpenRouteService · AI Gateway.

## Architecture in one breath
One Neo4j is canonical for domain + context + app data (ADR-002). Volatile dependencies sit behind
four adapters: `MemoryGateway` (NAMS), `AgentGateway` (Eve), `RoutingGateway` (ORS), and `lib/neo4j`.

## Getting started
```bash
cp .env.example .env.local        # fill in NPS, Neo4j, NAMS, Eve, auth, ORS keys
pnpm install
pnpm db:migrate                   # constraints + point/full-text/vector indexes
pnpm db:verify                    # sanity-check the schema
pnpm nams:spike                   # Phase-0 de-risk: prove NAMS writes land in our Neo4j (ADR-001)
pnpm ontology:setup               # create + activate the custom NAMS ontology (ADR-011)
pnpm dev                          # Next + the Eve ranger together (via withEve); open /plan to chat
```
> `pnpm dev` auto-starts the Eve agent behind the app. For Next without the agent (just Explore/Map),
> use `DISABLE_EVE=1 pnpm dev`. Agent details: `docs/PHASE2-INTEGRATION.md`.

## Basemap (Protomaps)
Maps use a self-hosted **Protomaps** vector basemap (no per-request key), styled via
`protomaps-themes-base`. `NEXT_PUBLIC_MAP_TILES_URL` defaults to `/basemap/us.pmtiles`; until that file
exists the maps fall back to MapLibre demo tiles automatically (`attachBasemapFallback`), so nothing
breaks on a fresh clone.

**Build the real basemap:**
1. Install the `pmtiles` CLI (go-pmtiles): `brew install pmtiles` (or download from
   [protomaps/go-pmtiles](https://github.com/protomaps/go-pmtiles/releases)).
2. Find the latest planet build at [build.protomaps.com](https://build.protomaps.com) (a daily
   `<YYYYMMDD>.pmtiles`).
3. Extract a continental-US slice into `public/basemap/us.pmtiles`:
   ```bash
   PMTILES_SOURCE=https://build.protomaps.com/<YYYYMMDD>.pmtiles pnpm build:basemap
   ```
   (optional overrides: `BASEMAP_BBOX`, `BASEMAP_MAXZOOM`, `BASEMAP_OUT`.) Restart `pnpm dev`.

**Production:** upload `us.pmtiles` to a CDN and set `NEXT_PUBLIC_MAP_TILES_URL` to that URL. The file
is gitignored (it's large). A MapLibre `style.json` URL (MapTiler/Stadia/etc.) also works in that var.

## Data sources (§5)
Beyond the NPS sync, structured "conditions" come from adapters in `lib/datasources/` (AD-3 pattern),
written graph-native onto `:Park`/`:ThingToDo`: **dark-sky/Bortle**, **crowd level + best months**
(NPS visitation), **trail difficulty** (derived from thing-to-do text), and **Recreation.gov**
reservation links. They're curated where no free live API exists, behind a stable interface so a live
feed can replace the seed. Apply them with `pnpm datasources:sync` (also runs on the slow sync tier).
They surface on park pages ("Conditions" — including a **monthly visitation bar chart** via
`@chakra-ui/charts`/Recharts that highlights the low-crowd best months), the Explore **dark-sky
facet**, the ranger's `best_time_to_visit` tool, and feed personalized ranking.

## QA remediation (P0–P3)
Hands-on QA feedback addressed across `/Users/.../plans/atomic-wibbling-cupcake.md`:
- **P0:** memory now captures signals (park view / add-to-trip → `CONSIDERED`, explicit ranger
  saves) + async NAMS→`PREFERS` reconciliation (`/me` "Learning…") + 20s onboarding; ranger renders
  **Markdown**; Plan page is **mobile-tabbed**; Chakra/Emotion **hydration** fixed (Chakra owns SSR).
- **P1:** `addStop` validates parkCodes (no nameless "1. Stop"); ranger card de-dup + bubble wrap;
  `:State.name` populated (no ", ,"); Explore **pagination + accurate counts**; **next/image**;
  Protomaps basemap; US-fit default view + a default layer on.
- **P2:** email validation; friendly empty/404; ranger retrieval steered by activity/topic intent;
  clickable+grouped park chips + Save/Plan actions; homepage CTAs + featured; mobile hamburger nav;
  chat autoscroll; clickable ranger cards; live trip-count badge.
- **P3:** **Related parks** (similar / nearby / often-planned-together) + park-local data
  (things-to-do/campgrounds/visitor-centers) on park pages; "why this" chips. *Deferred (roadmap):*
  external data sources (trails/weather/dark-sky/AQI/reservations), precomputed graph edges, and a
  dedicated graph-viz view.

## QA remediation — Round 2
- **P0:** fixed the every-page **hydration failure** (removed `useBreakpointValue` markup branching in
  `SiteNav`/`PlanPage` → CSS-responsive; added a per-request Emotion SSR registry in `app/provider.tsx`);
  **save-as-trip** now works (`build_itinerary` resolves park **names or codes**, tool errors render,
  no blank Ranger turns).
- **P1:** Protomaps basemap finished (correct `protomaps-themes-base` theme; set `NEXT_PUBLIC_MAP_TILES_URL`);
  cross-tool **card de-dup** by parkCode; **extraction recall** via a deterministic message term-scan
  (`lib/canonicalize.ts#extractCanonicalTerms` + expanded synonyms, wired into `lib/reconcile-memory.ts`);
  **orphan stops** filtered in `getTrip` + `pnpm cleanup:orphan-stops`.
- **P2:** park **name typeahead** (`ParkSearchInput`); branded **image fallback**; **streaming** renders
  plain text until complete (no raw-`**` flash); Markdown **tables**; park-detail `<h1>`.
- **P3:** personalized **For you** on home/Explore + "because you liked" chips; **Often planned together**
  on park pages; **graph-aware trip ordering** ("Optimize route"); a signature **graph view** at
  `/graph` (parks linked by shared topics) and an **interactive one-hop graph on every park page**, both
  rendered with the **Neo4j Visualization Library (NVL)** — `components/graph/NvlGraph.tsx`, client-only
  via `next/dynamic({ssr:false})`. _Roadmap (needs external API keys/
  datasets): dark-sky/Bortle, crowd levels/best-time, trail length/difficulty, structured drive-times,
  Recreation.gov reservations — add as adapters behind the AD-3 gateway pattern._

## Project layout
```
app/            Next.js App Router (pages + Route Handlers: /api/auth, /api/agent)
agent/          Eve agent — instructions.md, agent.ts, tools/, channels/eve.ts, hooks/
evals/          Eve eval suite (project root, not agent/evals)
lib/            adapters: neo4j, memory (NAMS), routing (ORS), auth (Better Auth) + domain logic
lib/agent-ctx.ts  server-bound caller identity for agent tools (R4)
db/             migrations (.cypher) + migrate/verify runners
scripts/        de-risk spikes
docs/           DECISIONS.md (ADRs), GLOSSARY.md, NAMS-FEEDBACK.md, PHASE2-INTEGRATION.md
tests/          integration (*.itest.ts) + e2e (Playwright *.spec.ts)
CLAUDE.md       working conventions + gotchas for contributors/agents
```

## Testing
```bash
pnpm test            # unit (always) + integration (skipped unless RUN_INTEGRATION=1)
pnpm test:unit       # pure-logic unit tests (mocked I/O)
RUN_INTEGRATION=1 pnpm test:integration   # needs an EMPTY Neo4j (CI uses an ephemeral container)
pnpm test:e2e        # Playwright (needs seeded Neo4j; `pnpm seed:test`)
```
- **Unit** (`lib/**/*.test.ts`): routing, embeddings, NPS pagination/retry, param sanitization,
  preference canonicalization + term-scan recall, nearest-neighbor route ordering, day-by-day pacing
  (`itinerary`), ICS + trip→ICS generation, server-bound caller identity (`agent-ctx`), basemap style
  selection (`mapStyle`), tombstone signatures, the §5 data-source derivations (dark-sky rating,
  best-months/crowd level, trail-difficulty classification, reservation links), and the result-shaping
  of `explain` / `memory-graph` / `share` / `collective` (DB mocked).
- **Integration** (`tests/integration/*.itest.ts`): real Neo4j — domain queries, map layers, trip
  service (stops, drive segments, alert check, per-user isolation), cross-graph recommendations +
  novelty, graph relationships (nearby / often-planned-together / constellation `graphNeighborhood`),
  the Better Auth adapter, memory (delete + tombstones + explain), and social (sharing + collective
  intelligence). ⚠️ Gated behind `RUN_INTEGRATION=1` because the seed MERGE-overwrites real
  parkCodes — never point it at a populated production DB.
- **E2E** (`tests/e2e/*.spec.ts`): public surface (landing → explore → facets → park detail → map →
  `/me` gating) + an **authenticated** flow (sign up → build trip → drive segments → day plan → alerts
  → share) via `E2E_TEST_MODE` email/password.
- **CI** (`.github/workflows/ci.yml`): unit/typecheck/build, then integration and e2e jobs each with a
  Neo4j service container, plus an opt-in evals job. Keep this suite green and extended as features land.

## Phase status
- **Phase 0 — Foundations:** ✅ scaffold, schema, four adapters, Eve agent skeleton, auth adapter,
  NAMS de-risk spike. Builds + typechecks clean.
- **Phase 1 — Explore:** ✅ NPS client + tiered Vercel-Workflow sync (`/api/sync`), content-hash
  embeddings, read queries + `/api/graph` BFF, Explore (faceted RSC), park detail (alerts + mini-map),
  MapLibre explorer (clustering + bbox), magic-link auth. Builds clean. **Untested at runtime** —
  needs live `NPS_API_KEY` / `NEO4J_*` / `AI_GATEWAY_API_KEY`; run `pnpm db:migrate` then
  `curl /api/sync?tier=slow` to populate.
- **Phase 2 — Plan + Ranger:** ✅ AD-1 validated via `pnpm nams:spike` (NAMS writes into our Neo4j).
  Trip service (reified stops + drive segments + two-tier alert check), `/api/trips`, two-pane `/plan`
  (itinerary builder + ranger chat), recommend/For-you (`lib/recommend`), canonicalizing preference
  bridges (`lib/bridges` + `lib/canonicalize`), custom NAMS ontology (`pnpm ontology:setup`), and the
  planning agent tools. Tools read server-bound identity from the Eve session context (no model-supplied
  userId, R4). Full test suite (unit + integration + e2e) + CI. Builds clean. **Remaining: feed the
  Better Auth user into Eve's session auth + deterministic persistence + session mapping against a
  running Eve dev server — see `docs/PHASE2-INTEGRATION.md`.**
- **Phase 3 — Personalize + Explain:** ✅ "Your memory" page (`/me`) with feedback + **durable delete
  via tombstones** (E3/E4, §13.4); "why this?" graph-grounded explanations (D4); **map layer toggles**
  (B3: campgrounds/visitor-centers/things-to-do/alerts) + **itinerary overlay** (B4); **day-by-day
  structuring** (C4, `suggestDays` + agent tool); Eve **eval suite** (`pnpm agent:eval`, opt-in CI job);
  accessibility pass (map list-view equivalent, aria labels). Observability: Eve **Agent Runs**
  (automatic) for the agent; `:SyncState` + `GET /api/sync` for sync health.
- **Phase 4 — Social & expansion:** ✅ shareable read-only trips + role-based links (C6/F4,
  `/trips/shared/[token]`), **ICS calendar export** (C6, `/api/trips/[id]/ics`), **opt-in collective
  intelligence** (E5, anonymized "travelers like you" via a single cross-user traversal), and a **Slack
  channel** scaffold (`agent/channels/slack.ts`, inert until `SLACK_*` env set). _Deferred (need
  external inputs): family/group accounts (F3 — larger multi-user design) and park boundary polygons
  (B5 — needs a licensed open boundary dataset, Open Q#3)._

Not an official NPS safety source — always defer to NPS.gov and rangers for life-safety decisions.
