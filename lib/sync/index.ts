import { RetryableError } from 'workflow';
import { readGraph, writeGraph } from '../neo4j';
import {
  fetchAll,
  fetchPage,
  NPS_PAGE_LIMIT,
  NpsRateLimitError,
  type NpsPark,
  type NpsAlert,
  type NpsCampground,
  type NpsThingToDo,
  type NpsActivityRef,
  type NpsGeneric,
  type NpsPlace,
  type NpsPerson,
  type NpsTour,
  type NpsPassportStamp,
  type NpsParkingLot,
  type NpsArticle,
  type NpsNewsRelease,
  type NpsMultimedia,
  type NpsLessonPlan,
} from '../nps';
import {
  upsertParks,
  upsertNamed,
  upsertCampgrounds,
  upsertThingsToDo,
  upsertAlerts,
  upsertVisitorCenters,
  upsertPlaces,
  upsertPeople,
  upsertTours,
  upsertAmenityBridges,
  upsertPassportStamps,
  upsertParkingLots,
  upsertArticles,
  upsertEntrancePasses,
  upsertEntranceFees,
  upsertEvents,
  upsertNewsReleases,
  upsertMultimedia,
  upsertLessonPlans,
} from './upserts';
import { embedParks } from './embed-parks';
import { embedPlaces, embedPeople, embedArticles } from './embed-nodes';
import { deriveNear } from './derive-near';
import { deriveSharedEdges } from './derive-shared';
import { deriveCentrality } from './derive-centrality';
import { deriveCommunities } from './derive-communities';
import { refreshNearProjection } from './project-near';
import { deriveCoConsidered } from './derive-co-considered';
import { deriveLessonJoins } from './derive-lesson-joins';
import { deriveLessonTopics } from './derive-lesson-topics';
import { decomposeLessons } from './decompose-lessons';
import { syncTrails } from './sync-trails';
import { deriveTrailElevation } from './derive-trail-elevation';
import { deriveTrailLogistics } from './derive-trail-logistics';
import { joinThingsToDoTrails } from './join-thingstodo-trails';
import { enrichTrailsOSM } from './enrich-trails-osm';

/**
 * NPS sync orchestrator (ADR-007).
 *
 * Authored with `"use workflow"` / `"use step"` directives so it runs as a DURABLE, checkpointed
 * Vercel Workflow when deployed (each step retried/resumed independently), and as a plain resumable
 * async function locally. We ALSO record per-step checkpoints in a `:SyncState` node so progress is
 * inspectable and resumable regardless of the runtime. Idempotent MERGE makes every step re-runnable.
 *
 * Tiers (§9.2): SLOW (corpus, 6–12h) and FAST (alerts/events, 2h aligned to upstream). ALL runs both
 * in one invocation — used by the once-daily cron on Vercel Hobby (which caps cron frequency at daily).
 */

export type Tier = 'slow' | 'fast' | 'all';

export interface StepResult {
  resource: string;
  counts: Record<string, number>;
  ms: number;
}

async function checkpoint(resource: string, tier: Tier, counts: Record<string, number>, ms: number) {
  await writeGraph(
    `MERGE (s:SyncState {resource: $resource})
     SET s.tier = $tier, s.lastRunAt = datetime(), s.lastStatus = 'ok',
         s.lastCounts = $counts, s.lastMs = $ms`,
    { resource, tier, counts: JSON.stringify(counts), ms },
  );
}

async function markFailed(resource: string, message: string) {
  await writeGraph(
    `MERGE (s:SyncState {resource: $resource})
     SET s.lastStatus = 'error', s.lastError = $message, s.lastErrorAt = datetime()`,
    { resource, message },
  ).catch(() => {});
}

/**
 * Resume window per tier (§9.2): a step that already has a fresh, successful checkpoint is skipped on
 * re-run — so retrying a sync that died partway (e.g. NPS hourly rate-limit on the big corpus steps)
 * resumes where it failed instead of re-burning quota from the top. The daily cron's 24h gap always
 * exceeds the slow window, so it still does a full refresh. `SYNC_FORCE=1` forces every step to re-run.
 */
const RESUME_TTL_SECONDS: Record<Tier, number> = { slow: 20 * 3600, fast: 90 * 60, all: 20 * 3600 };

async function recentlyOk(resource: string, tier: Tier): Promise<Record<string, number> | null> {
  const rows = await readGraph<{ counts: string | null }>(
    `MATCH (s:SyncState {resource: $resource})
     WHERE s.lastStatus = 'ok' AND s.lastRunAt > datetime() - duration({seconds: toInteger($secs)})
     RETURN s.lastCounts AS counts`,
    { resource, secs: RESUME_TTL_SECONDS[tier] },
  ).catch(() => []);
  if (!rows.length) return null;
  try {
    return rows[0].counts ? (JSON.parse(rows[0].counts) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Run one resource step with retry/backoff; record a checkpoint. Skips if a fresh checkpoint exists. */
async function step(
  resource: string,
  tier: Tier,
  fn: () => Promise<Record<string, number>>,
): Promise<StepResult> {
  'use step';
  if (process.env.SYNC_FORCE !== '1') {
    const prior = await recentlyOk(resource, tier);
    if (prior) return { resource, counts: { ...prior, skipped: 1 }, ms: 0 };
  }
  const start = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const counts = await fn();
      const ms = Date.now() - start;
      await checkpoint(resource, tier, counts, ms);
      return { resource, counts, ms };
    } catch (err) {
      // A rate-limit/quota pause is not a failure — stop now, leave the step un-checkpointed so the
      // next run retries it. Retrying within this run won't help (the hourly window hasn't reset).
      if (err instanceof NpsRateLimitError) {
        await markPaused(resource, err.message);
        return { resource, counts: { paused: 1 }, ms: Date.now() - start };
      }
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  await markFailed(resource, (lastErr as Error)?.message ?? 'unknown');
  // On Vercel this signals the workflow to retry the step later without losing prior steps.
  throw new RetryableError(`sync step '${resource}' failed: ${(lastErr as Error)?.message}`);
}

async function markPaused(resource: string, message: string) {
  await writeGraph(
    `MERGE (s:SyncState {resource: $resource})
     SET s.lastStatus = 'paused', s.lastError = $message, s.lastErrorAt = datetime()`,
    { resource, message },
  ).catch(() => {});
}

/**
 * Page-and-checkpoint a large NPS resource (NPS-expansion fix): fetch one page, upsert it immediately,
 * and persist a page cursor on `:SyncState` — so a rate-limit (429) mid-resource saves all prior pages
 * and *pauses* instead of discarding everything (the old `fetchAll`-then-upsert was all-or-nothing, and
 * /places alone is 17k+ records = far more than one hourly window's 1000-request budget). On the next
 * run the step resumes from the saved cursor; when the last page lands it's marked `ok`. Idempotent
 * MERGE upserts make replaying a partially-applied page safe.
 */
async function pagedStep<T>(
  resource: string,
  npsResource: string,
  fields: string[] | undefined,
  upsertBatch: (batch: T[]) => Promise<number>,
): Promise<StepResult> {
  'use step';
  if (process.env.SYNC_FORCE !== '1') {
    const prior = await recentlyOk(resource, 'slow');
    if (prior) return { resource, counts: { ...prior, skipped: 1 }, ms: 0 };
  }
  const start = Date.now();
  const params: Record<string, string> = fields?.length ? { fields: fields.join(',') } : {};

  // Resume from a saved cursor when the prior run paused; otherwise start fresh.
  const saved = await readGraph<{ page: number; count: number; status: string | null }>(
    `MATCH (s:SyncState {resource: $resource})
     RETURN coalesce(s.partialPage, 0) AS page, coalesce(s.partialCount, 0) AS count, s.lastStatus AS status`,
    { resource },
  ).catch(() => []);
  let page = saved[0]?.status === 'paused' ? (saved[0]?.page ?? 0) : 0;
  let count = saved[0]?.status === 'paused' ? (saved[0]?.count ?? 0) : 0;

  try {
    for (;;) {
      const pageData = await fetchPage<T>(npsResource, page * NPS_PAGE_LIMIT, params);
      if (pageData.data.length > 0) count += await upsertBatch(pageData.data);
      page += 1;
      const total = Number(pageData.total) || 0;
      const done = pageData.data.length === 0 || page * NPS_PAGE_LIMIT >= total;
      await writeGraph(
        `MERGE (s:SyncState {resource: $resource})
         SET s.tier = 'slow', s.partialPage = $page, s.partialCount = $count,
             s.lastStatus = $status, s.lastRunAt = datetime()`,
        { resource, page, count, status: done ? 'ok' : 'paused' },
      );
      if (done) break;
      await new Promise((r) => setTimeout(r, 120)); // polite between pages
    }
  } catch (err) {
    if (err instanceof NpsRateLimitError) {
      await markPaused(resource, err.message); // cursor already persisted on the last successful page
      return { resource, counts: { count, page, paused: 1 }, ms: Date.now() - start };
    }
    await markFailed(resource, (err as Error)?.message ?? 'unknown');
    throw new RetryableError(`sync step '${resource}' failed: ${(err as Error)?.message}`);
  }
  const ms = Date.now() - start;
  await writeGraph(
    `MERGE (s:SyncState {resource: $resource}) SET s.lastCounts = $counts, s.lastMs = $ms, s.partialPage = 0`,
    { resource, counts: JSON.stringify({ count }), ms },
  );
  return { resource, counts: { count }, ms };
}

// ─── Tier orchestration ────────────────────────────────────────────────────────
export async function runSlowSync(): Promise<StepResult[]> {
  'use workflow';
  const out: StepResult[] = [];

  out.push(
    await step('activities', 'slow', async () => ({
      count: await upsertNamed('Activity', await fetchAll<NpsActivityRef>('activities')),
    })),
  );
  out.push(
    await step('topics', 'slow', async () => ({
      count: await upsertNamed('Topic', await fetchAll<NpsActivityRef>('topics')),
    })),
  );
  out.push(
    await step('amenities', 'slow', async () => ({
      count: await upsertNamed('Amenity', await fetchAll<NpsActivityRef>('amenities')),
    })),
  );
  out.push(
    await step('parks', 'slow', async () => ({
      count: await upsertParks(
        await fetchAll<NpsPark>('parks', { fields: ['images', 'entranceFees', 'operatingHours', 'contacts', 'addresses'] }),
      ),
    })),
  );
  out.push(
    await step('campgrounds', 'slow', async () => ({
      // F1 hours + F3 inventory (campsites/fees) — additive fields=.
      count: await upsertCampgrounds(
        await fetchAll<NpsCampground>('campgrounds', { fields: ['operatingHours', 'campsites', 'fees'] }),
      ),
    })),
  );
  out.push(
    await step('visitorcenters', 'slow', async () => ({
      count: await upsertVisitorCenters(await fetchAll<NpsGeneric>('visitorcenters', { fields: ['operatingHours', 'accessibility'] })),
    })),
  );
  out.push(
    await step('thingstodo', 'slow', async () => ({
      // F7 (granular facets) + F5 (accessibilityInformation) — all additive fields=.
      count: await upsertThingsToDo(
        await fetchAll<NpsThingToDo>('thingstodo', {
          fields: [
            'longDescription',
            'duration',
            'durationDescription',
            'timeOfDay',
            'season',
            'topics',
            'tags',
            'arePetsPermitted',
            'isReservationRequired',
            'doFeesApply',
            'accessibilityInformation',
          ],
        }),
      ),
    })),
  );
  // NPS expansion (Phase 1): places, people, tours, then amenity bridges (need places/VCs to exist).
  // These are paged-and-checkpointed (/places alone is 17k+ records) so a rate-limit pauses + resumes
  // mid-resource instead of discarding the whole step.
  out.push(await pagedStep<NpsPlace>('places', 'places', ['images', 'amenities', 'tags', 'audioDescription'], upsertPlaces));
  out.push(await pagedStep<NpsPerson>('people', 'people', ['images', 'tags'], upsertPeople));
  out.push(await pagedStep<NpsTour>('tours', 'tours', undefined, upsertTours));
  out.push(
    await step('amenities-places', 'slow', async () =>
      upsertAmenityBridges(await fetchAll<NpsGeneric>('amenities/parksplaces'), 'Place', 'places'),
    ),
  );
  out.push(
    await step('amenities-vcs', 'slow', async () =>
      upsertAmenityBridges(await fetchAll<NpsGeneric>('amenities/parksvisitorcenters'), 'VisitorCenter', 'visitorcenters'),
    ),
  );

  // Content endpoints (Phase 1 cont.): passport stamps, parking lots, articles. Entrance passes are
  // derived from already-synced Park JSON (no extra NPS fetch) so they don't add rate-limit pressure.
  out.push(await pagedStep<NpsPassportStamp>('passportstamplocations', 'passportstamplocations', undefined, upsertPassportStamps));
  // F10: request static detail fields (accessibility/hours; livedata stays a runtime concern).
  out.push(await pagedStep<NpsParkingLot>('parkinglots', 'parkinglots', ['accessibility', 'operatingHours'], upsertParkingLots));
  // bodyText activates the article_fulltext/article_embedding indexes (latent-bug fix, plan F8); when
  // fields= is set NPS drops bodyText from the default payload, so it must be requested explicitly.
  out.push(await pagedStep<NpsArticle>('articles', 'articles', ['images', 'bodyText'], upsertArticles));
  out.push(
    await step('entrancepasses', 'slow', async () => ({
      passes: await upsertEntrancePasses(),
      fees: await upsertEntranceFees(), // F2: (:Park)-[:CHARGES]->(:EntranceFee) from already-synced JSON
    })),
  );

  // Real hiking trails (ADR-066/067): per-park NPS GIS → named :Trail + simplified Blob geometry. Opt-in
  // (heavy: per-park ArcGIS fetch + Blob writes); the national 470-park ingest is a progressive ops rollout,
  // content-hash gated per park so re-runs are cheap. Runs after parks/parkinglots/places exist.
  if (process.env.SYNC_TRAILS === '1') {
    out.push(await step('trails', 'slow', async () => syncTrails()));
  }

  out.push(await step('embeddings', 'slow', async () => embedParks()));
  // Semantic vectors for the new nodes (content-hash gated; first run is a large one-time backfill).
  // Places + people are the high-value semantic targets and embed by default. Articles are bulky P3
  // content (~19k) — opt in with EMBED_ARTICLES=1 to avoid an unexpected embedding bill.
  out.push(await step('embed-places', 'slow', async () => embedPlaces()));
  out.push(await step('embed-people', 'slow', async () => embedPeople()));
  if (process.env.EMBED_ARTICLES === '1') {
    out.push(await step('embed-articles', 'slow', async () => embedArticles()));
  }

  // F6: multimedia is a large, opt-in corpus (galleries can be 10k+ assets) — gate behind SYNC_MULTIMEDIA=1.
  if (process.env.SYNC_MULTIMEDIA === '1') {
    out.push(await pagedStep<NpsMultimedia>('multimedia-audio', 'multimedia/audio', ['transcript'], (b) => upsertMultimedia('AudioFile', b)));
    out.push(await pagedStep<NpsMultimedia>('multimedia-galleries', 'multimedia/galleries', undefined, (b) => upsertMultimedia('Gallery', b)));
    out.push(await pagedStep<NpsMultimedia>('multimedia-videos', 'multimedia/videos', ['transcript'], (b) => upsertMultimedia('Video', b)));
  }

  // Educator content for the "Ranger School" courseware platform (webcams use the runtime conditions
  // path, not a graph node — see lib/conditions.ts).
  out.push(
    await pagedStep<NpsLessonPlan>(
      'lessonplans',
      'lessonplans',
      // NPS /lessonplans supports: questionObjective, commonCore (+ default parks/duration/gradeLevel/subject).
      // It does NOT return objective/durationInMinutes/topics/image/relatedParks for this resource.
      ['questionObjective', 'commonCore', 'parks', 'duration'],
      upsertLessonPlans,
    ),
  );
  // Ranger School (Phase 2): AI-decompose lesson plans into the cached Module/Lesson/QuizQuestion spine.
  // Opt-in (spends model tokens) + content-hash gated, like EMBED_ARTICLES. See docs/RANGER_SCHOOL_DESIGN.md §3.
  if (process.env.DECOMPOSE_LESSONPLANS === '1') {
    out.push(await step('decompose-lessons', 'slow', async () => decomposeLessons()));
  }

  // Derivations run last (need the full corpus): NEAR proximity (F9) + materialized shared-topic/activity (bonus).
  out.push(await step('derive-near', 'slow', async () => deriveNear()));
  out.push(await step('derive-shared', 'slow', async () => deriveSharedEdges()));
  // Trail derivations (ADR-068/069/072): spatial logistics + the curated :ThingToDo join, then (opt-in)
  // elevation+difficulty (needs an elevation sampler). Each needs trails to exist.
  if (process.env.SYNC_TRAILS === '1') {
    out.push(await step('derive-trail-logistics', 'slow', async () => deriveTrailLogistics()));
    out.push(await step('join-thingstodo-trails', 'slow', async () => joinThingsToDoTrails()));
    if (process.env.SYNC_TRAIL_ELEVATION === '1') {
      out.push(await step('derive-trail-elevation', 'slow', async () => deriveTrailElevation()));
    }
  }
  // OSM-fill (ADR-072, Phase 2): fill trails for NPS-empty parks. Opt-in; runs after sync-trails so the
  // "NPS-empty" set is accurate. ODbL attribution rides on source='osm'.
  if (process.env.ENRICH_OSM_TRAILS === '1') {
    out.push(await step('enrich-trails-osm', 'slow', async () => enrichTrailsOSM()));
  }
  // Co-considered lens (#4): cross-user CONSIDERED overlap, k-anonymity ≥5. Independent of the NPS corpus
  // (rides the slow sync because that's where derivations live; sparse until the user base grows).
  out.push(await step('derive-co-considered', 'slow', async () => deriveCoConsidered()));
  // Graph analytics (#7): GDS centrality + community detection over the materialized SHARES_* edges. Each
  // no-ops cleanly on a Neo4j without the GDS plugin (guard is inside the fn, so the step list is stable).
  out.push(await step('derive-centrality', 'slow', async () => deriveCentrality()));
  out.push(await step('derive-communities', 'slow', async () => deriveCommunities()));
  // Keep the resident parks-near GDS projection fresh for weighted pathfinding (#6).
  out.push(await step('project-near', 'slow', async () => refreshNearProjection()));
  // Ranger School (F6 cross-feature join): (:LessonPlan)-[:CAN_USE_MEDIA]->(media ABOUT the same park).
  out.push(await step('derive-lesson-joins', 'slow', async () => deriveLessonJoins()));
  // Ranger School: ground lesson plans + quizzes in their park's topics (NPS lessonplans carry none), so
  // per-topic mastery/struggle tracking works across the catalog. Runs after decompose (needs the quizzes).
  out.push(await step('derive-lesson-topics', 'slow', async () => deriveLessonTopics()));

  return out;
}

export async function runFastSync(): Promise<StepResult[]> {
  'use workflow';
  const out: StepResult[] = [];
  out.push(await step('alerts', 'fast', async () => upsertAlerts(await fetchAll<NpsAlert>('alerts'))));
  out.push(
    await step('events', 'fast', async () => {
      // F4: richer events + recurrence expanded to CalendarDate over a 120-day horizon from today.
      const todayISO = new Date().toISOString().slice(0, 10);
      return upsertEvents(await fetchAll<NpsGeneric>('events', { fields: ['dates', 'types', 'tags'] }), todayISO);
    }),
  );
  // F8: news releases are volatile → fast tier (like alerts/events).
  out.push(
    await step('newsreleases', 'fast', async () => ({
      count: await upsertNewsReleases(await fetchAll<NpsNewsRelease>('newsreleases', { fields: ['relatedParks'] })),
    })),
  );
  return out;
}

export async function runSync(tier: Tier): Promise<StepResult[]> {
  if (tier === 'fast') return runFastSync();
  if (tier === 'all') return [...(await runSlowSync()), ...(await runFastSync())];
  return runSlowSync();
}

/** Current sync health for observability dashboards. */
export async function syncStatus() {
  return readGraph(
    `MATCH (s:SyncState)
     RETURN s.resource AS resource, s.tier AS tier, s.lastStatus AS status,
            s.lastRunAt AS lastRunAt, s.lastCounts AS counts, s.lastMs AS ms, s.lastError AS error
     ORDER BY resource`,
  );
}
