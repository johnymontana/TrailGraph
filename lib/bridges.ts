import { writeGraph, readGraph } from './neo4j';
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
  // Amenities are captured via the dedicated REQUIRES path (setTravelConstraints), not PREFERS here.
  if (!target || target.kind === 'amenity') return { canonicalized: false };
  const kind: 'activity' | 'topic' = target.kind;

  const sig = preferenceSignature(kind, target.name);
  if (await isSuppressed(userId, sig)) {
    return { canonicalized: true, suppressed: true, target: { kind, name: target.name } };
  }

  const label = kind === 'activity' ? 'Activity' : 'Topic';
  await writeGraph(
    `MATCH (d:\`${label}\` {name: $name})
     MERGE (u:User {userId: $userId})
     MERGE (u)-[r:PREFERS]->(d)
     SET r.category = $category, r.value = $value, r.method = $method, r.at = datetime()`,
    { userId, name: target.name, category, value, method: target.method },
  );
  return { canonicalized: true, target: { kind, name: target.name } };
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

export interface TravelConstraints {
  wheelchair: boolean;
  rvMaxLengthFt: number | null;
  requiredAmenities: string[];
}

/**
 * Accessibility / travel constraints (NPS-expansion P0 #1). Scalar constraints live on a single
 * per-user `(:User)-[:TRAVELS_WITH]->(:Constraint {userId})`; categorical needs are
 * `(:User)-[:REQUIRES]->(:Amenity)`. The ranger sets these once; recommend/explain honor them on every
 * turn. Each `requiredAmenity` is canonicalized to a real `:Amenity` node (misses are dropped, no guess).
 */
export async function setTravelConstraints(
  userId: string,
  c: { wheelchair?: boolean; rvMaxLengthFt?: number | null; requiredAmenities?: string[] },
): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[:TRAVELS_WITH]->(con:Constraint {userId:$userId})
     SET con.wheelchair = CASE WHEN $wheelchair IS NULL THEN con.wheelchair ELSE $wheelchair END,
         con.rvMaxLengthFt = CASE WHEN $rv IS NULL THEN con.rvMaxLengthFt ELSE toInteger($rv) END,
         con.at = datetime()`,
    { userId, wheelchair: c.wheelchair ?? null, rv: c.rvMaxLengthFt ?? null },
  );
  for (const raw of c.requiredAmenities ?? []) {
    const target = await canonicalizeValue(raw);
    if (target?.kind !== 'amenity') continue;
    await writeGraph(
      `MATCH (am:Amenity {name:$name}) MERGE (u:User {userId:$userId}) MERGE (u)-[:REQUIRES]->(am)`,
      { userId, name: target.name },
    );
  }
}

export async function getTravelConstraints(userId: string): Promise<TravelConstraints> {
  const rows = await readGraph<{ wheelchair: boolean | null; rvMaxLengthFt: number | null; required: string[] }>(
    `MATCH (u:User {userId:$userId})
     OPTIONAL MATCH (u)-[:TRAVELS_WITH]->(con:Constraint)
     OPTIONAL MATCH (u)-[:REQUIRES]->(am:Amenity)
     RETURN con.wheelchair AS wheelchair, con.rvMaxLengthFt AS rvMaxLengthFt,
            [x IN collect(DISTINCT am.name) WHERE x IS NOT NULL] AS required`,
    { userId },
  );
  const r = rows[0];
  return {
    wheelchair: r?.wheelchair ?? false,
    rvMaxLengthFt: r?.rvMaxLengthFt ?? null,
    requiredAmenities: r?.required ?? [],
  };
}

/** Clear accessibility/travel constraints (the TRAVELS_WITH constraint + all REQUIRES edges). */
export async function clearTravelConstraints(userId: string): Promise<void> {
  await writeGraph(
    `MATCH (u:User {userId:$userId})
     OPTIONAL MATCH (u)-[tw:TRAVELS_WITH]->(con:Constraint) DETACH DELETE con
     WITH u OPTIONAL MATCH (u)-[req:REQUIRES]->() DELETE req`,
    { userId },
  );
}

/**
 * Passes the user holds (NPS-expansion P2 #9): `(:User)-[:HOLDS]->(:EntrancePass)`. Defaults to the
 * canonical national "America the Beautiful" annual pass (`atb-annual`), which the cost model uses for
 * break-even. The pass node is created by the `entrancepasses` sync step; we MERGE it here too so
 * recording a pass works even before a sync has run.
 */
export async function recordPass(userId: string, passId = 'atb-annual'): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (e:EntrancePass {id:$passId})
       ON CREATE SET e.name = CASE WHEN $passId = 'atb-annual'
                                   THEN 'America the Beautiful – Annual Pass' ELSE $passId END,
                     e.cost = CASE WHEN $passId = 'atb-annual' THEN 80.0 ELSE e.cost END,
                     e.scope = CASE WHEN $passId = 'atb-annual' THEN 'national' ELSE e.scope END
     MERGE (u)-[:HOLDS]->(e)`,
    { userId, passId },
  );
}

export async function clearPass(userId: string, passId = 'atb-annual'): Promise<void> {
  await writeGraph(
    `MATCH (u:User {userId:$userId})-[h:HOLDS]->(:EntrancePass {id:$passId}) DELETE h`,
    { userId, passId },
  );
}

export async function getHeldPasses(userId: string): Promise<{ id: string; name: string; cost: number | null }[]> {
  return readGraph(
    `MATCH (u:User {userId:$userId})-[:HOLDS]->(e:EntrancePass)
     RETURN e.id AS id, e.name AS name, e.cost AS cost ORDER BY name ASC`,
    { userId },
  );
}

/**
 * Passport stamp collection (NPS-expansion P2 #8): `(:User)-[:COLLECTED]->(:PassportStamp)`. A pure UI
 * op (the user marks what they've collected) — the collection *is* memory and drives "stamps along my
 * route" + "nearest uncollected stamp".
 */
export async function collectStamp(userId: string, stampId: string): Promise<boolean> {
  const r = await writeGraph<{ ok: boolean }>(
    `MATCH (st:PassportStamp {id:$stampId})
     MERGE (u:User {userId:$userId}) MERGE (u)-[:COLLECTED]->(st)
     RETURN true AS ok`,
    { userId, stampId },
  );
  return r.length > 0;
}

export async function uncollectStamp(userId: string, stampId: string): Promise<void> {
  await writeGraph(
    `MATCH (u:User {userId:$userId})-[c:COLLECTED]->(:PassportStamp {id:$stampId}) DELETE c`,
    { userId, stampId },
  );
}

export interface Availability {
  start: string | null;
  end: string | null;
}

/**
 * Travel-window availability (NPS-expansion P2 #7): `(:User)-[:AVAILABLE {start,end}]->(:Season)`.
 * Stored once; events whose dates fall inside it are surfaced ("there's a dark-sky festival during
 * your week in September"). Dates are ISO `YYYY-MM-DD` strings. userId-scoped (R4).
 */
export async function setAvailability(userId: string, start: string | null, end: string | null): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[a:AVAILABLE]->(s:Season {userId:$userId})
     SET a.start = $start, a.end = $end, a.at = datetime()`,
    { userId, start: start || null, end: end || null },
  );
}

export async function getAvailability(userId: string): Promise<Availability> {
  const rows = await readGraph<Availability>(
    `MATCH (u:User {userId:$userId})-[a:AVAILABLE]->(:Season)
     RETURN a.start AS start, a.end AS end`,
    { userId },
  );
  return { start: rows[0]?.start ?? null, end: rows[0]?.end ?? null };
}

export async function clearAvailability(userId: string): Promise<void> {
  await writeGraph(
    `MATCH (u:User {userId:$userId})-[a:AVAILABLE]->(s:Season) DETACH DELETE s`,
    { userId },
  );
}
