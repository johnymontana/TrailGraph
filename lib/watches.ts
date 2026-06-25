import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { WATCH_CAP } from './watch-cap';

/**
 * Proactive Ranger watches (ADR-052) — a user attaches a standing :Watch to a saved trip or a park.
 * The daily digest cron (`/api/digests`) walks every active watch and rolls up road/gate closures,
 * clear-sky-on-new-moon windows, fee-free days, and alert spikes into the user's in-app inbox (and an
 * opt-in email). userId-scoped (R4). Deduped by user+kind+refId so re-watching is idempotent.
 */
export type WatchKind = 'trip' | 'park';

export interface Watch {
  id: string;
  kind: WatchKind;
  refId: string; // tripId or parkCode
  label: string | null;
  createdAt: string | null;
}

// WATCH_CAP lives in the dependency-free `./watch-cap` module so the client card can import it too.
export { WATCH_CAP } from './watch-cap';

export type CreateWatchResult = { id: string } | { error: string };

export async function createWatch(userId: string, kind: WatchKind, refId: string, label?: string): Promise<CreateWatchResult> {
  // Re-watching an existing (kind, refId) is always allowed (idempotent label update). Only a NEW watch
  // is blocked once the user is at the cap, so a small TOCTOU race can at worst yield one extra watch.
  const existing = await readGraph<{ id: string }>(
    `MATCH (:User {userId:$userId})-[:WATCHES]->(w:Watch {kind:$kind, refId:$refId}) RETURN w.id AS id`,
    { userId, kind, refId },
  );
  if (!existing.length) {
    const counted = await readGraph<{ total: number }>(
      `OPTIONAL MATCH (:User {userId:$userId})-[:WATCHES]->(w:Watch) RETURN count(w) AS total`,
      { userId },
    );
    if ((counted[0]?.total ?? 0) >= WATCH_CAP) {
      return { error: `You've reached the limit of ${WATCH_CAP} watches. Remove one first (clear_watch).` };
    }
  }
  const id = randomUUID();
  const rows = await writeGraph<{ id: string }>(
    `
    MERGE (u:User {userId:$userId})
    MERGE (u)-[:WATCHES]->(w:Watch {userId:$userId, kind:$kind, refId:$refId})
      ON CREATE SET w.id = $id, w.createdAt = datetime()
    SET w.label = $label
    RETURN w.id AS id
    `,
    { userId, kind, refId, id, label: label ?? null },
  );
  return { id: rows[0]?.id ?? id };
}

export async function listWatches(userId: string): Promise<Watch[]> {
  return readGraph<Watch>(
    `MATCH (:User {userId:$userId})-[:WATCHES]->(w:Watch)
     RETURN w.id AS id, w.kind AS kind, w.refId AS refId, w.label AS label, toString(w.createdAt) AS createdAt
     ORDER BY w.createdAt DESC`,
    { userId },
  );
}

export async function deleteWatch(userId: string, watchId: string): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[:WATCHES]->(w:Watch {id:$watchId}) DETACH DELETE w`,
    { userId, watchId },
  );
}

/** All distinct userIds with ≥1 watch, for the digest fan-out. Includes email opt-in + address + token. */
export async function usersWithWatches(): Promise<
  { userId: string; email: string | null; emailDigest: boolean; unsubToken: string | null }[]
> {
  return readGraph(
    `MATCH (u:User)-[:WATCHES]->(:Watch)
     RETURN DISTINCT u.userId AS userId, u.email AS email,
            coalesce(u.emailDigest, false) AS emailDigest, u.unsubToken AS unsubToken`,
    {},
  );
}
