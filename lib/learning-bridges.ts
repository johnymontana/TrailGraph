import { randomUUID } from 'node:crypto';
import { writeGraph, readGraph } from './neo4j';
import { canonicalizeValue } from './canonicalize';
import { learningSignature, isSuppressed, suppress } from './tombstone';

/**
 * Ranger School learning context-graph bridges (docs/RANGER_SCHOOL_DESIGN.md §5). The learning twin of
 * lib/bridges.ts: every writer MERGEs on (:User {userId}) (lazy-create, R4), stamps datetime(), clamps
 * numeric props, and — for facts a user can dismiss (struggles) — is tombstone-aware. Topic-valued bridges
 * canonicalize to a real domain :Topic first (no guessing; a miss writes nothing, like writePreferenceBridge).
 * No NAMS dependency — pure graph, fully testable.
 *
 * Topic edges key on :Topic{name} (not id) — consistent with writePreferenceBridge and the canonicalize
 * module's name-uniqueness assumption (its alias map is keyed by lowercased name). This is safe while topic
 * names stay unique (the design's §11 no-duplicate-name-keyed-Topic commitment); a holistic fix (resolve to
 * :Topic.id, or a Topic.name UNIQUE constraint covering PREFERS too) is tracked in RANGER_SCHOOL_DESIGN §17.
 */

/** Clamp a 0..1 score/confidence (mirrors setPreferenceWeight's Math.max/min clamp). Pure. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

const MASTERY_ALPHA = 0.3;

/**
 * Exponential weighted moving average for per-topic mastery: nudges the stored score toward the latest
 * sample. previous=null (first observation) returns the sample. Pure + clamped to [0,1] so the edge prop
 * never goes unbounded (the documented ranking gotcha). Pure (unit-tested).
 */
export function ewma(previous: number | null, sample: number, alpha = MASTERY_ALPHA): number {
  const s = clamp01(sample);
  if (previous == null) return s;
  return clamp01(alpha * s + (1 - alpha) * clamp01(previous));
}

/** Enroll a user in a course: (:User)-[:ENROLLED_IN {at}]->(:LessonPlan). Idempotent; `at` set once. */
export async function enrollIn(userId: string, lessonPlanId: string): Promise<void> {
  await writeGraph(
    `MATCH (lp:LessonPlan {id: $lessonPlanId})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:ENROLLED_IN]->(lp)
       ON CREATE SET r.at = datetime()`,
    { userId, lessonPlanId },
  );
}

/** Mark a lesson complete: (:User)-[:COMPLETED {score 0..1, at}]->(:Lesson). Idempotent (re-completion updates). */
export async function completeLesson(userId: string, lessonId: string, score: number): Promise<void> {
  await writeGraph(
    `MATCH (l:Lesson {id: $lessonId})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:COMPLETED]->(l)
     SET r.score = $score, r.at = datetime()`,
    { userId, lessonId, score: clamp01(score) },
  );
}

/**
 * Record a quiz answer: (:User)-[:ANSWERED {attempt, correct, choiceId, score, at}]->(:QuizQuestion).
 * MERGE-latest (one bounded edge per user-quiz, attempt counter increments) rather than CREATE-per-attempt,
 * so the mastery window reads recent DISTINCT questions and edges never grow unbounded. The grading tool
 * (Phase 4) is the only caller; it grades deterministically against QuizQuestion.correctId server-side.
 */
export async function recordQuizAttempt(
  userId: string,
  quizQuestionId: string,
  correct: boolean,
  choiceId: string,
): Promise<void> {
  await writeGraph(
    `MATCH (q:QuizQuestion {id: $quizId})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:ANSWERED]->(q)
     SET r.attempt = coalesce(r.attempt, 0) + 1,
         r.correct = $correct, r.choiceId = $choiceId,
         r.score = CASE WHEN $correct THEN 1.0 ELSE 0.0 END,
         r.at = datetime()`,
    { userId, quizId: quizQuestionId, correct, choiceId },
  );
}

/**
 * Record that a user is struggling with a topic: (:User)-[:STRUGGLES_WITH {confidence 0..1, lastSeen}]->(:Topic).
 * Canonicalizes the topic to a real domain :Topic (miss → write nothing). Tombstone-aware: if the user
 * dismissed this struggle, it is NOT recreated. Returns true iff an edge was written.
 */
export async function recordStruggle(userId: string, topic: string, confidence: number): Promise<boolean> {
  const target = await canonicalizeValue(topic);
  if (target?.kind !== 'topic') return false; // no real domain Topic → no guessing
  if (await isSuppressed(userId, learningSignature('struggle:topic', target.name))) return false;
  await writeGraph(
    `MATCH (t:Topic {name: $name})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:STRUGGLES_WITH]->(t)
     SET r.confidence = $confidence, r.lastSeen = datetime()`,
    { userId, name: target.name, confidence: clamp01(confidence) },
  );
  return true;
}

/**
 * Durable dismiss of a struggle: tombstone it (so reconciliation won't resurrect it) + delete the edge.
 * `topicName` is the canonical Topic name as surfaced in the UI/memory (matches recordStruggle's signature).
 */
export async function deleteStruggle(userId: string, topicName: string): Promise<void> {
  await suppress(userId, learningSignature('struggle:topic', topicName));
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:STRUGGLES_WITH]->(:Topic {name:$name}) DELETE r`,
    { userId, name: topicName },
  );
}

/**
 * Update per-topic mastery via EWMA: (:User)-[:MASTERY {score 0..1, lastSeen}]->(:Topic). Reads the prior
 * score, blends in the new sample (latest correctness 0..1). NOT tombstone-aware (derived performance, not a
 * user-asserted fact). Returns {previous, score} for progression display, or null when the topic doesn't canonicalize.
 */
export async function recordMastery(
  userId: string,
  topic: string,
  sample: number,
): Promise<{ previous: number | null; score: number } | null> {
  const target = await canonicalizeValue(topic);
  if (target?.kind !== 'topic') return null;
  const rows = await readGraph<{ previous: number | null }>(
    `MATCH (:User {userId:$userId})-[r:MASTERY]->(:Topic {name:$name}) RETURN r.score AS previous`,
    { userId, name: target.name },
  );
  const previous = rows[0]?.previous ?? null;
  const score = ewma(previous, sample);
  await writeGraph(
    `MATCH (t:Topic {name:$name})
     MERGE (u:User {userId:$userId})
     MERGE (u)-[r:MASTERY]->(t)
     SET r.score = $score, r.lastSeen = datetime()`,
    { userId, name: target.name, score },
  );
  return { previous, score };
}

/** Award a badge: (:User)-[:EARNED {at}]->(:Badge). Returns true iff newly earned (drives milestone celebration). */
export async function earnBadge(userId: string, badgeId: string): Promise<boolean> {
  const rows = await writeGraph<{ newlyEarned: boolean }>(
    `MATCH (b:Badge {id: $badgeId})
     MERGE (u:User {userId: $userId})
     OPTIONAL MATCH (u)-[pre:EARNED]->(b)
     WITH b, u, pre IS NOT NULL AS already
     MERGE (u)-[e:EARNED]->(b)
       ON CREATE SET e.at = datetime()
     RETURN NOT already AS newlyEarned`,
    { userId, badgeId },
  );
  return rows[0]?.newlyEarned ?? false;
}

export interface IssuedCertificate {
  id: string;
  shareSlug: string;
  score: number | null;
  issuedAt: string | null;
}

/**
 * Issue an IMMUTABLE completion certificate: (:Certificate {id, userId, lessonPlanId, shareSlug, score,
 * issuedAt}) + (:User)-[:ISSUED]->(cert). MERGE-on-(userId,lessonPlanId) with ON CREATE only, so re-issuing
 * returns the original unchanged. `shareSlug` is a random public token for the share page. Returns the cert,
 * or null if the lesson plan doesn't exist.
 */
export async function issueCertificate(userId: string, lessonPlanId: string, score: number): Promise<IssuedCertificate | null> {
  const certId = `cert:${userId}:${lessonPlanId}`;
  const shareSlug = randomUUID().replace(/-/g, '').slice(0, 16);
  const rows = await writeGraph<IssuedCertificate>(
    `MATCH (lp:LessonPlan {id:$lessonPlanId})
     MERGE (u:User {userId:$userId})
     MERGE (c:Certificate {userId:$userId, lessonPlanId:$lessonPlanId})
       ON CREATE SET c.id = $certId, c.shareSlug = $shareSlug, c.score = $score, c.issuedAt = datetime()
     MERGE (u)-[:ISSUED]->(c)
     RETURN c.id AS id, c.shareSlug AS shareSlug, c.score AS score, toString(c.issuedAt) AS issuedAt`,
    { userId, lessonPlanId, certId, shareSlug, score: clamp01(score) },
  );
  return rows[0] ?? null;
}
