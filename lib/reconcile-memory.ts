import { readGraph } from './neo4j';
import { memory } from './memory';
import { writePreferenceBridge } from './bridges';
import { recordStruggle, recordMastery } from './learning-bridges';
import { extractCanonicalTerms, isParksRelevant } from './canonicalize';

/**
 * Async memory reconciliation (ADR-011 Path B + R2 §3.2). Two recall sources, both → canonical
 * `(:User)-[:PREFERS]->(:Activity|:Topic)` bridges (tombstone-aware):
 *   1. NAMS-extracted `preference` entities (semantic, eventually-consistent).
 *   2. A deterministic scan of the user's own chat messages against the activity/topic vocabulary —
 *      independent of NAMS, so one sentence ("alpine lakes, dark skies, easy hikes") yields the full
 *      set even when NAMS recall is partial.
 */
export async function reconcileUser(userId: string): Promise<{ written: number; skipped: number }> {
  let written = 0;
  let skipped = 0;
  const bridge = async (category: string, value: string) => {
    const res = await writePreferenceBridge({ userId, category, value }).catch(() => null);
    if (res?.canonicalized && !res.suppressed) written++;
    else skipped++;
  };

  // 1) NAMS-extracted preferences.
  const prefs = await memory.searchEntities({ userId, type: 'preference' }).catch(() => []);
  for (const p of prefs) await bridge('activity', p.name);

  // 2) Deterministic scan of the user's recent chat messages.
  const sessions = await readGraph<{ conversationId: string }>(
    `MATCH (:User {userId:$userId})-[:HAS_AGENT_SESSION]->(s:AgentSession)
     RETURN s.conversationId AS conversationId`,
    { userId },
  ).catch(() => []);
  for (const { conversationId } of sessions) {
    const ctx = await memory.getConversationContext(userId, conversationId).catch(() => null);
    const userMessages = (ctx?.recentMessages ?? []).filter((m) => m.role === 'user');
    for (const msg of userMessages) {
      // Gate per message (R5 §2.6): skip off-topic turns (a recipe, a coding question) so they never
      // pollute the preference graph — even if they coincidentally name a domain word.
      if (!(await isParksRelevant(msg.content))) continue;
      for (const { target } of await extractCanonicalTerms(msg.content)) {
        await bridge(target.kind, target.name);
      }
    }
  }
  return { written, skipped };
}

/**
 * Async learning reconciliation (Ranger School, docs/RANGER_SCHOOL_DESIGN.md §12) — the learning sibling
 * of reconcileUser. Source A (live now): a deterministic scan of the user's recent ANSWERED edges, grouped
 * by the quiz's TESTS topic, deriving rolling mastery + a struggle signal where recent correctness is low.
 * Both writes are idempotent + tombstone-aware (recordStruggle honors a dismissed struggle). Adaptivity does
 * NOT wait on this — recordQuizAttempt writes the ANSWERED edge synchronously; this only enriches the
 * STRUGGLES_WITH / MASTERY rollups. Source B (NAMS "I'm confused"/"explain again" signals) is deferred to
 * Phase 4 with the tutor tools, once the NAMS entity types are finalized.
 */
export async function reconcileUserLearning(userId: string): Promise<{ struggles: number; mastery: number }> {
  const rows = await readGraph<{ topic: string; mastery: number; wrongRatio: number }>(
    `MATCH (:User {userId:$userId})-[a:ANSWERED]->(:QuizQuestion)-[:TESTS]->(t:Topic)
     WITH t, a ORDER BY a.at DESC
     WITH t, collect(a)[0..10] AS recent
     WHERE size(recent) > 0
     WITH t, toFloat(size([x IN recent WHERE x.correct])) / toFloat(size(recent)) AS mastery
     RETURN t.name AS topic, mastery, 1.0 - mastery AS wrongRatio`,
    { userId },
  );
  let struggles = 0;
  let mastery = 0;
  for (const r of rows) {
    if (await recordMastery(userId, r.topic, r.mastery).catch(() => null)) mastery++;
    // Struggle only when recent correctness is poor; confidence = how strongly they're struggling.
    if (r.wrongRatio >= 0.5 && (await recordStruggle(userId, r.topic, r.wrongRatio).catch(() => false))) struggles++;
  }
  return { struggles, mastery };
}

/** Reconcile every user who has chatted (has an agent session). For the scheduled job. */
export async function reconcileAll(): Promise<{ users: number; written: number }> {
  const users = await readGraph<{ userId: string }>(
    `MATCH (u:User)-[:HAS_AGENT_SESSION]->() RETURN DISTINCT u.userId AS userId`,
  );
  let written = 0;
  for (const { userId } of users) {
    written += (await reconcileUser(userId)).written;
  }
  return { users: users.length, written };
}
