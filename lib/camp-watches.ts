import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';

/**
 * Camp Watch (Campgrounds feature, Phase 2) — cancellation alerting. A user attaches a `:CampWatch` with a
 * criteria tuple (campgrounds + dates + site/hookup/ada constraints); a SEPARATE poller (`/api/camp-watch`,
 * every 15 min) diffs current availability against the watch's `lastSnapshot` and notifies on a fresh
 * opening. A new node (NOT an extension of the daily-digest `:Watch`) keeps the proven digest path untouched
 * and lets the poller query `MATCH (:CampWatch {active:true})` with rich criteria + a per-watch diff snapshot.
 * userId-scoped (R4). Availability itself is never stored here — only the watch criteria + last snapshot.
 */

export const CAMP_WATCH_CAP = 10; // free-tier cap (mirrors WATCH_CAP)

export interface CampWatch {
  id: string;
  userId: string;
  campgroundIds: string[];
  recAreaId: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  nights: number | null;
  minNights: number | null;
  siteType: string | null; // 'tent' | 'rv' | 'group' | 'any'
  weekendOnly: boolean;
  hookups: string | null; // 'none' | '30amp' | '50amp' | 'full'
  ada: boolean;
  active: boolean;
  lastNotifiedAt: string | null;
  lastSnapshot: string | null; // JSON array of open "campgroundId|date|siteId" keys
  label: string | null;
  createdAt: string | null;
}

export type CreateCampWatchInput = Omit<
  CampWatch,
  'id' | 'userId' | 'active' | 'lastNotifiedAt' | 'lastSnapshot' | 'createdAt'
>;
export type CreateCampWatchResult = { id: string } | { error: string };

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The heart of cancellation detection: which currently-open "campgroundId|date|siteId" keys are NEW vs the
 * watch's last snapshot. A fresh key = a site that opened since we last looked (i.e. a cancellation).
 * Pure (unit-tested). Tolerates a null/garbage prior snapshot (treats it as empty → everything is fresh).
 */
export function freshOpenings(prevSnapshotJson: string | null, currentKeys: string[]): string[] {
  let prev: Set<string>;
  try {
    const v = prevSnapshotJson ? JSON.parse(prevSnapshotJson) : [];
    prev = new Set(Array.isArray(v) ? (v as string[]) : []);
  } catch {
    prev = new Set();
  }
  return currentKeys.filter((k) => !prev.has(k));
}

export async function createCampWatch(userId: string, c: CreateCampWatchInput): Promise<CreateCampWatchResult> {
  const counted = await readGraph<{ total: number }>(
    `OPTIONAL MATCH (:User {userId:$userId})-[:WATCHING]->(w:CampWatch {active:true}) RETURN count(w) AS total`,
    { userId },
  );
  if ((counted[0]?.total ?? 0) >= CAMP_WATCH_CAP) {
    return { error: `You've reached the limit of ${CAMP_WATCH_CAP} camp watches. Clear one first (clear_camp_watch).` };
  }
  const id = randomUUID();
  const rows = await writeGraph<{ id: string }>(
    `MERGE (u:User {userId:$userId})
     CREATE (u)-[:WATCHING]->(w:CampWatch {
        id:$id, userId:$userId, campgroundIds:$campgroundIds, recAreaId:$recAreaId,
        startDate:$startDate, endDate:$endDate, nights:$nights, minNights:$minNights,
        siteType:$siteType, weekendOnly:$weekendOnly, hookups:$hookups, ada:$ada,
        label:$label, active:true, lastSnapshot:null, lastNotifiedAt:null, createdAt:datetime() })
     RETURN w.id AS id`,
    {
      id,
      userId,
      campgroundIds: c.campgroundIds ?? [],
      recAreaId: c.recAreaId ?? null,
      startDate: c.startDate,
      endDate: c.endDate,
      nights: c.nights ?? null,
      minNights: c.minNights ?? null,
      siteType: c.siteType ?? null,
      weekendOnly: c.weekendOnly ?? false,
      hookups: c.hookups ?? null,
      ada: c.ada ?? false,
      label: c.label ?? null,
    },
  );
  return { id: rows[0]?.id ?? id };
}

export async function listCampWatches(userId: string): Promise<CampWatch[]> {
  return readGraph<CampWatch>(
    `MATCH (:User {userId:$userId})-[:WATCHING]->(w:CampWatch)
     RETURN w.id AS id, w.userId AS userId, coalesce(w.campgroundIds, []) AS campgroundIds,
            w.recAreaId AS recAreaId, w.startDate AS startDate, w.endDate AS endDate,
            w.nights AS nights, w.minNights AS minNights, w.siteType AS siteType,
            coalesce(w.weekendOnly, false) AS weekendOnly, w.hookups AS hookups,
            coalesce(w.ada, false) AS ada, coalesce(w.active, true) AS active,
            toString(w.lastNotifiedAt) AS lastNotifiedAt, w.lastSnapshot AS lastSnapshot,
            w.label AS label, toString(w.createdAt) AS createdAt
     ORDER BY w.createdAt DESC`,
    { userId },
  );
}

export async function deleteCampWatch(userId: string, watchId: string): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[:WATCHING]->(w:CampWatch {id:$watchId}) DETACH DELETE w`,
    { userId, watchId },
  );
}

/** Active, non-expired watches with the user's email opt-in — the poller fan-out. */
export async function usersWithCampWatches(): Promise<
  { watch: CampWatch; email: string | null; emailOptIn: boolean; unsubToken: string | null }[]
> {
  return readGraph<{ watch: CampWatch; email: string | null; emailOptIn: boolean; unsubToken: string | null }>(
    `MATCH (u:User)-[:WATCHING]->(w:CampWatch)
     WHERE coalesce(w.active, true) = true AND w.endDate >= $today
     RETURN w {
              .id, .userId, .recAreaId, .startDate, .endDate, .nights, .minNights, .siteType,
              .hookups, .label, .lastSnapshot,
              campgroundIds: coalesce(w.campgroundIds, []),
              weekendOnly: coalesce(w.weekendOnly, false), ada: coalesce(w.ada, false),
              active: coalesce(w.active, true), lastNotifiedAt: toString(w.lastNotifiedAt),
              createdAt: toString(w.createdAt)
            } AS watch,
            u.email AS email,
            coalesce(u.campAlertsEmail, u.emailDigest, false) AS emailOptIn, u.unsubToken AS unsubToken`,
    { today: today() },
  );
}

/** Auto-deactivate watches whose trip window has passed (run at the top of the poller). */
export async function expireCampWatches(): Promise<number> {
  const rows = await writeGraph<{ n: number }>(
    `MATCH (:User)-[:WATCHING]->(w:CampWatch) WHERE coalesce(w.active, true) = true AND w.endDate < $today
     SET w.active = false RETURN count(w) AS n`,
    { today: today() },
  );
  return rows[0]?.n ?? 0;
}

/** Persist the diff snapshot + (when notified) the throttle stamp after a poll. */
export async function recordCampWatchSnapshot(id: string, snapshot: string, notified: boolean): Promise<void> {
  await writeGraph(
    `MATCH (w:CampWatch {id:$id})
     SET w.lastSnapshot = $snapshot,
         w.lastNotifiedAt = CASE WHEN $notified THEN toString(datetime()) ELSE w.lastNotifiedAt END`,
    { id, snapshot, notified },
  );
}
