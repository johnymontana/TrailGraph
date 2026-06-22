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
} from './upserts';
import { embedParks } from './embed-parks';

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

// ─── Generic upserts for the long-tail resources ───────────────────────────────
async function upsertEvents(events: NpsGeneric[]): Promise<{ active: number; expired: number }> {
  const rows = events.map((e) => ({
    id: String(e.id),
    title: String(e.title ?? ''),
    dateStart: (e.datestart as string) ?? null,
    dateEnd: (e.dateend as string) ?? null,
    parkCode: (e.sitecode as string) ?? (e.parkCode as string) ?? null,
    lat: e.latitude ? Number(e.latitude) : null,
    lng: e.longitude ? Number(e.longitude) : null,
  }));
  const ids = rows.map((r) => r.id);
  const up = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MERGE (e:Event {id: row.id})
       SET e.title = row.title, e.dateStart = row.dateStart, e.dateEnd = row.dateEnd,
           e.active = true,
           e.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                             THEN point({latitude: row.lat, longitude: row.lng}) ELSE e.location END,
           e.lastSyncedAt = datetime()
     WITH e, row WHERE row.parkCode IS NOT NULL
     MATCH (p:Park {parkCode: row.parkCode}) MERGE (e)-[:HELD_AT]->(p)
     RETURN count(e) AS c`,
    { rows },
  );
  const exp = await writeGraph<{ c: number }>(
    `MATCH (e:Event) WHERE e.active = true AND NOT e.id IN $ids SET e.active = false RETURN count(e) AS c`,
    { ids },
  );
  return { active: up[0]?.c ?? 0, expired: exp[0]?.c ?? 0 };
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
      count: await upsertCampgrounds(await fetchAll<NpsCampground>('campgrounds')),
    })),
  );
  out.push(
    await step('visitorcenters', 'slow', async () => ({
      count: await upsertVisitorCenters(await fetchAll<NpsGeneric>('visitorcenters')),
    })),
  );
  out.push(
    await step('thingstodo', 'slow', async () => ({
      count: await upsertThingsToDo(await fetchAll<NpsThingToDo>('thingstodo')),
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
      upsertAmenityBridges(await fetchAll<NpsGeneric>('amenities/parksvisitorcenters'), 'VisitorCenter', 'visitorCenters'),
    ),
  );

  // Content endpoints (Phase 1 cont.): passport stamps, parking lots, articles. Entrance passes are
  // derived from already-synced Park JSON (no extra NPS fetch) so they don't add rate-limit pressure.
  out.push(await pagedStep<NpsPassportStamp>('passportstamplocations', 'passportstamplocations', undefined, upsertPassportStamps));
  out.push(await pagedStep<NpsParkingLot>('parkinglots', 'parkinglots', undefined, upsertParkingLots));
  out.push(await pagedStep<NpsArticle>('articles', 'articles', ['images'], upsertArticles));
  out.push(await step('entrancepasses', 'slow', async () => ({ count: await upsertEntrancePasses() })));

  out.push(await step('embeddings', 'slow', async () => embedParks()));

  return out;
}

export async function runFastSync(): Promise<StepResult[]> {
  'use workflow';
  const out: StepResult[] = [];
  out.push(await step('alerts', 'fast', async () => upsertAlerts(await fetchAll<NpsAlert>('alerts'))));
  out.push(await step('events', 'fast', async () => upsertEvents(await fetchAll<NpsGeneric>('events'))));
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
