import { writeGraph } from './neo4j';
import { memory } from './memory';
import { canonicalizeValue } from './canonicalize';
import { preferenceSignature, suppress, isSuppressed } from './tombstone';

/**
 * Cross-graph bridges (ADR-010). Path A = exact, deterministic edges written with the parkCode/name
 * the caller already holds (no fuzzy matching). These connect the user's context to real domain nodes
 * and power the §8.3 novelty-aware recommendations.
 */

/** Record that the agent considered/recommended a concrete park (exact parkCode). */
export async function considerPark(userId: string, parkCode: string, source = 'agent_recommendation') {
  await writeGraph(
    `MATCH (p:Park {parkCode: $parkCode})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:CONSIDERED]->(p)
     SET r.lastAt = datetime(), r.source = $source`,
    { userId, parkCode, source },
  );
}

export interface PreferenceBridgeResult {
  canonicalized: boolean;
  suppressed?: boolean;
  target?: { kind: 'activity' | 'topic'; name: string };
}

/**
 * Write the canonical (:User)-[:PREFERS {category}]->(:Activity|:Topic) bridge for a preference value
 * (ADR-011), resolving the user's words to the domain vocabulary. Honors tombstones (ADR-016): if the
 * user previously deleted this preference, we do NOT recreate it. NO NAMS dependency — testable.
 */
export async function writePreferenceBridge(args: {
  userId: string;
  category: string;
  value: string;
}): Promise<PreferenceBridgeResult> {
  const { userId, category, value } = args;
  const target = await canonicalizeValue(value);
  if (!target) return { canonicalized: false };

  const sig = preferenceSignature(target.kind, target.name);
  if (await isSuppressed(userId, sig)) {
    return { canonicalized: true, suppressed: true, target: { kind: target.kind, name: target.name } };
  }

  const label = target.kind === 'activity' ? 'Activity' : 'Topic';
  await writeGraph(
    `MATCH (d:\`${label}\` {name: $name})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:PREFERS]->(d)
     SET r.category = $category, r.value = $value, r.method = $method, r.at = datetime()`,
    { userId, name: target.name, category, value, method: target.method },
  );
  return { canonicalized: true, target: { kind: target.kind, name: target.name } };
}

/**
 * Persist an explicit preference: raw fact to NAMS (recall/history/feedback) AND the canonical
 * deterministic bridge so personalization works immediately (ADR-009/011).
 */
export async function recordPreference(args: {
  userId: string;
  category: string;
  value: string;
}): Promise<PreferenceBridgeResult & { prefId?: string }> {
  // The canonical bridge is what powers the UI, so always write it; NAMS is best-effort (Labs/
  // eventually-consistent) and must not block an explicit save if it's slow or unavailable.
  let prefId: string | undefined;
  try {
    prefId = (await memory.addPreference({ ...args, context: 'explicit' })).id;
  } catch (err) {
    console.error('[bridges] NAMS addPreference failed (non-fatal):', (err as Error).message);
  }
  const bridge = await writePreferenceBridge(args);
  return { ...bridge, prefId };
}

/**
 * Durable delete of a canonical preference (E3/E4): remove the PREFERS edge AND tombstone it so the
 * extraction/canonicalization pipeline won't resurrect it (ADR-016).
 */
export async function deletePreference(userId: string, kind: 'activity' | 'topic', name: string): Promise<void> {
  await suppress(userId, preferenceSignature(kind, name));
  const label = kind === 'activity' ? 'Activity' : 'Topic';
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:PREFERS]->(:\`${label}\` {name:$name}) DELETE r`,
    { userId, name },
  );
}

/**
 * Tune how strongly a preference influences recommendations (§5f). weight 1 = default, <1 down-ranks,
 * 0 effectively mutes it, >1 boosts. `forYou` ranks by the sum of matched weights.
 */
export async function setPreferenceWeight(
  userId: string,
  kind: 'activity' | 'topic',
  name: string,
  weight: number,
): Promise<void> {
  const w = Math.max(0, Math.min(3, weight));
  const label = kind === 'activity' ? 'Activity' : 'Topic';
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:PREFERS]->(:\`${label}\` {name:$name})
     SET r.weight = $w, r.weightAt = datetime()`,
    { userId, name, w },
  );
}

/** E4 feedback: record thumbs on a canonical preference (and confidence to NAMS when prefId known). */
export async function setPreferenceFeedback(
  userId: string,
  kind: 'activity' | 'topic',
  name: string,
  vote: 'up' | 'down',
): Promise<void> {
  const label = kind === 'activity' ? 'Activity' : 'Topic';
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:PREFERS]->(:\`${label}\` {name:$name})
     SET r.feedback = $vote, r.feedbackAt = datetime()`,
    { userId, name, vote },
  );
}

/** Remove a CONSIDERED bridge (user no longer wants this park excluded/remembered). */
export async function deleteConsidered(userId: string, parkCode: string): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:CONSIDERED]->(:Park {parkCode:$parkCode}) DELETE r`,
    { userId, parkCode },
  );
}

/** Clear every CONSIDERED bridge for the user (R4 §2.7 — "considered" grows unbounded). */
export async function deleteAllConsidered(userId: string): Promise<void> {
  await writeGraph(`MATCH (:User {userId:$userId})-[r:CONSIDERED]->(:Park) DELETE r`, { userId });
}
