import { readGraph, writeGraph } from '../neo4j';

/**
 * Derive topics for lesson plans + their quizzes (Ranger School, docs/RANGER_SCHOOL_DESIGN.md §5). NPS
 * lesson plans carry NO topics, so live decomposed quizzes have no `(:QuizQuestion)-[:TESTS]->(:Topic)` edge
 * and per-topic mastery/struggle tracking is empty for everything but the seeded course. This post-decompose
 * derivation grounds each lesson plan in its **park's real `:Topic` nodes** (never minting a topic — the §11
 * discipline) by matching the park's topic names against the lesson plan's title/subject as WHOLE WORDS, then
 * backfills the `TESTS` edges onto the already-cached quizzes. Idempotent; safe to re-run.
 */

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Park topics whose name appears as whole word(s) in `text`. Word-boundary + punctuation-safe (so "Ice"
 * matches "the Ice Age" but NOT "service"), and multi-word topics ("Native American Heritage") match only
 * when every word is present. Pure (unit-tested).
 */
export function matchParkTopics<T extends { name: string }>(text: string, topics: T[]): T[] {
  const words = new Set(tokenize(text));
  return topics.filter((t) => {
    const toks = tokenize(t.name);
    return toks.length > 0 && toks.every((tok) => words.has(tok));
  });
}

export async function deriveLessonTopics(): Promise<{ linkedPlans: number; relatesEdges: number; testsEdges: number }> {
  // Candidate topics = the park's HAS_TOPIC topics (real :Topic ids/names), per park-linked lesson plan.
  const rows = await readGraph<{ id: string; title: string | null; subject: string | null; topics: { id: string; name: string }[] }>(
    `MATCH (lp:LessonPlan)-[:ABOUT]->(p:Park)
     OPTIONAL MATCH (p)-[:HAS_TOPIC]->(t:Topic)
     WITH lp, [x IN collect(DISTINCT {id: t.id, name: t.name}) WHERE x.id IS NOT NULL AND x.name IS NOT NULL] AS topics
     WHERE size(topics) > 0
     RETURN lp.id AS id, lp.title AS title, lp.subject AS subject, topics`,
  );

  // Match in JS (correct word-boundary handling), key on topic id (Topic.name isn't unique — §17).
  const links = rows
    .map((r) => ({
      id: r.id,
      topicIds: matchParkTopics(`${r.title ?? ''} ${r.subject ?? ''}`, r.topics).map((t) => t.id),
    }))
    .filter((l) => l.topicIds.length > 0);
  if (!links.length) return { linkedPlans: 0, relatesEdges: 0, testsEdges: 0 };

  const rel = await writeGraph<{ relates: number }>(
    `UNWIND $links AS link
     MATCH (lp:LessonPlan {id: link.id})
     UNWIND link.topicIds AS tid
     MATCH (t:Topic {id: tid})
     MERGE (lp)-[:RELATES_TO_TOPIC]->(t)
     RETURN count(*) AS relates`,
    { links },
  );

  // Backfill the TESTS edges on the (already-cached) quizzes under the now-linked lesson plans.
  const ids = links.map((l) => l.id);
  const tst = await writeGraph<{ tests: number }>(
    `UNWIND $ids AS lpid
     MATCH (lp:LessonPlan {id: lpid})-[:RELATES_TO_TOPIC]->(t:Topic)
     MATCH (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson)-[:HAS_QUESTION]->(q:QuizQuestion)
     MERGE (q)-[:TESTS]->(t)
     RETURN count(*) AS tests`,
    { ids },
  );

  return { linkedPlans: links.length, relatesEdges: rel[0]?.relates ?? 0, testsEdges: tst[0]?.tests ?? 0 };
}
