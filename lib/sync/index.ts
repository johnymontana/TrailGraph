import { RetryableError } from 'workflow';
import { readGraph, writeGraph } from '../neo4j';
import {
  fetchAll,
  type NpsPark,
  type NpsAlert,
  type NpsCampground,
  type NpsThingToDo,
  type NpsActivityRef,
  type NpsGeneric,
} from '../nps';
import {
  upsertParks,
  upsertNamed,
  upsertCampgrounds,
  upsertThingsToDo,
  upsertAlerts,
  upsertVisitorCenters,
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
 * Tiers (§9.2): SLOW (corpus, 6–12h) and FAST (alerts/events, 2h aligned to upstream).
 */

export type Tier = 'slow' | 'fast';

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

/** Run one resource step with retry/backoff; record a checkpoint. */
async function step(
  resource: string,
  tier: Tier,
  fn: () => Promise<Record<string, number>>,
): Promise<StepResult> {
  'use step';
  const start = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const counts = await fn();
      const ms = Date.now() - start;
      await checkpoint(resource, tier, counts, ms);
      return { resource, counts, ms };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  await markFailed(resource, (lastErr as Error)?.message ?? 'unknown');
  // On Vercel this signals the workflow to retry the step later without losing prior steps.
  throw new RetryableError(`sync step '${resource}' failed: ${(lastErr as Error)?.message}`);
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
  return tier === 'fast' ? runFastSync() : runSlowSync();
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
