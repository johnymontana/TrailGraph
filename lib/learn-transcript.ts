import { readGraph, writeGraph } from './neo4j';

/**
 * Per-lesson tutor transcript store (full-fidelity replay). We persist the CLIENT's authoritative Eve event
 * stream (`agent.events`) + the resumable session cursor (`agent.session`) per (user, lesson), keyed by a
 * composite id, so the lesson player rehydrates the chat WITH its interactive quiz/feedback cards on reload.
 * This is separate from NAMS memory (persist-turn.ts), which only holds simplified text and is session-scoped.
 * Events/session are stored as JSON strings (opaque to us — we round-trip them verbatim into `initialEvents`).
 */
export interface TutorTranscript {
  events: unknown[];
  session: unknown | null;
}

const EMPTY: TutorTranscript = { events: [], session: null };

function transcriptId(userId: string, lessonId: string): string {
  return `${userId}::${lessonId}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Load a learner's saved tutor transcript for one lesson (empty when none stored yet). */
export async function getTutorTranscript(userId: string, lessonId: string): Promise<TutorTranscript> {
  const rows = await readGraph<{ events: string | null; session: string | null }>(
    `MATCH (:User {userId: $userId})-[:HAS_TRANSCRIPT]->(t:TutorTranscript {id: $id})
     RETURN t.events AS events, t.session AS session`,
    { userId, id: transcriptId(userId, lessonId) },
  );
  const r = rows[0];
  if (!r) return EMPTY;
  return { events: safeParse(r.events, [] as unknown[]), session: safeParse(r.session, null) };
}

/** Upsert a learner's tutor transcript for one lesson (idempotent MERGE on the composite id). */
export async function saveTutorTranscript(userId: string, lessonId: string, data: TutorTranscript): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId: $userId})
     MERGE (u)-[:HAS_TRANSCRIPT]->(t:TutorTranscript {id: $id})
     SET t.lessonId = $lessonId, t.events = $events, t.session = $session, t.updatedAt = datetime()`,
    {
      userId,
      id: transcriptId(userId, lessonId),
      lessonId,
      events: JSON.stringify(data.events ?? []),
      session: JSON.stringify(data.session ?? null),
    },
  );
}
