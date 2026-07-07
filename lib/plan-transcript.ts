import { readGraph, writeGraph } from './neo4j';

/**
 * Per-user `/plan` ranger-chat transcript (ADR-076 P3.9), the sibling of `lib/learn-transcript.ts`. We
 * persist the CLIENT's authoritative Eve event stream (`agent.events`) per user — ONE ranger conversation
 * per user, not per lesson — so a reload / pull-to-refresh on mobile restores the thread WITH its cards
 * instead of emptying it. Events are stored as an opaque JSON string, round-tripped verbatim into
 * `initialEvents`. The session cursor is deliberately NOT persisted (mirrors the lesson player): a reload
 * replays the thread for display but starts a fresh Eve session on the next send, so a stale/expired
 * server session can never wedge the next turn.
 */
export interface PlanTranscript {
  events: unknown[];
}

const EMPTY: PlanTranscript = { events: [] };

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Load a user's saved /plan chat transcript (empty when none stored yet). */
export async function getPlanTranscript(userId: string): Promise<PlanTranscript> {
  const rows = await readGraph<{ events: string | null }>(
    `MATCH (:User {userId: $userId})-[:HAS_PLAN_TRANSCRIPT]->(t:PlanTranscript {userId: $userId})
     RETURN t.events AS events`,
    { userId },
  );
  const r = rows[0];
  if (!r) return EMPTY;
  return { events: safeParse(r.events, [] as unknown[]) };
}

/** Upsert a user's /plan chat transcript (idempotent MERGE on userId — one per user). */
export async function savePlanTranscript(userId: string, data: PlanTranscript): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId: $userId})
     MERGE (u)-[:HAS_PLAN_TRANSCRIPT]->(t:PlanTranscript {userId: $userId})
     SET t.events = $events, t.updatedAt = datetime()`,
    { userId, events: JSON.stringify(data.events ?? []) },
  );
}
