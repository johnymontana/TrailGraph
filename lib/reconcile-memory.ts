import { readGraph } from './neo4j';
import { memory } from './memory';
import { writePreferenceBridge } from './bridges';
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
