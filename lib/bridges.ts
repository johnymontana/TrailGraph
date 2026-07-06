import { writeGraph, readGraph } from './neo4j';
import { memory } from './memory';
import { canonicalizeValue } from './canonicalize';
import { preferenceSignature, suppress, isSuppressed } from './tombstone';
import { ACCESS_AMENITIES, ACCESS_NAME_BY_ID } from './datasources/accessibility';

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
 * Merge the user's durable (saved) constraints with per-query / trip-scoped overrides (R5 §2.2). Used by
 * `find_parks` to honor a one-trip or companion need (e.g. "my mom uses a wheelchair") for a single
 * search WITHOUT persisting it as a durable global filter. Per-query scalars take precedence when
 * provided; required amenities are a union (a one-trip need *adds* to the user's standing needs). Pure.
 */
export function mergeConstraints(
  saved: TravelConstraints,
  overrides: { wheelchair?: boolean; rvMaxLengthFt?: number | null; requiredAmenities?: string[] },
): TravelConstraints {
  return {
    wheelchair: overrides.wheelchair ?? saved.wheelchair,
    rvMaxLengthFt: overrides.rvMaxLengthFt ?? saved.rvMaxLengthFt,
    requiredAmenities: [...new Set([...saved.requiredAmenities, ...(overrides.requiredAmenities ?? [])])],
  };
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

/** Canonical accessibility amenity ids (F5) the user can require — for the `set_accessibility_needs` tool. */
export const ACCESSIBILITY_FEATURE_IDS = ACCESS_AMENITIES.map((a) => a.id);

/**
 * F5: record the user's accessibility needs as `(:User)-[:REQUIRES]->(:Amenity {accessibility})`, reusing
 * the existing REQUIRES bridge so `vibeSearch`/`explain`/`recommend` honor them with no new filter code.
 * MERGEs the canonical amenity so it works even before a sync has tagged it. Returns the ids applied.
 */
export async function setAccessibilityNeeds(userId: string, featureIds: string[]): Promise<string[]> {
  const valid = [...new Set(featureIds)].filter((id) => ACCESS_AMENITIES.some((a) => a.id === id));
  if (!valid.length) return [];
  await writeGraph(
    `MERGE (u:User {userId: $userId})
     WITH u UNWIND $ids AS aid
     MERGE (am:Amenity {id: aid}) ON CREATE SET am.name = $names[aid], am.accessibility = true
     MERGE (u)-[:REQUIRES]->(am)`,
    { userId, ids: valid, names: ACCESS_NAME_BY_ID },
  );
  return valid;
}

/** Clear only the user's accessibility REQUIRES edges (P2-2) — leaves non-accessibility amenity needs +
 * the wheelchair/RV scalar constraints intact (unlike `clearTravelConstraints`). */
export async function clearAccessibilityNeeds(userId: string): Promise<void> {
  await writeGraph(
    `MATCH (u:User {userId:$userId})-[r:REQUIRES]->(am:Amenity)
     WHERE coalesce(am.accessibility, false) = true OR am.id IN $ids
     DELETE r`,
    { userId, ids: ACCESSIBILITY_FEATURE_IDS },
  );
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

// ── Trail memory (ADR-071): preferences + saved/wishlisted/done trails ────────────────────────────────
export interface TrailPreferences {
  maxMiles: number | null;
  maxGainFt: number | null;
  difficulty: string | null;
  avoidExposure: boolean;
  dogsRequired: boolean;
}

/**
 * Trail preferences — a single per-user `(:User)-[:PREFERS_TRAIL]->(:TrailPrefs {userId})` anchor (mirrors
 * `setTravelConstraints`; the `:TrailPrefs` UNIQUE constraint is migration 025). Partial: a null field keeps
 * the saved value. The ranger sets these once (scope-confirmed); find_trails/recommend honor them.
 */
export async function setTrailPreferences(
  userId: string,
  p: {
    maxMiles?: number | null;
    maxGainFt?: number | null;
    difficulty?: string | null;
    avoidExposure?: boolean | null;
    dogsRequired?: boolean | null;
  },
): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[:PREFERS_TRAIL]->(tp:TrailPrefs {userId:$userId})
     SET tp.maxMiles = CASE WHEN $maxMiles IS NULL THEN tp.maxMiles ELSE $maxMiles END,
         tp.maxGainFt = CASE WHEN $maxGainFt IS NULL THEN tp.maxGainFt ELSE toInteger($maxGainFt) END,
         tp.difficulty = CASE WHEN $difficulty IS NULL THEN tp.difficulty ELSE $difficulty END,
         tp.avoidExposure = CASE WHEN $avoidExposure IS NULL THEN tp.avoidExposure ELSE $avoidExposure END,
         tp.dogsRequired = CASE WHEN $dogsRequired IS NULL THEN tp.dogsRequired ELSE $dogsRequired END,
         tp.at = datetime()`,
    {
      userId,
      maxMiles: p.maxMiles ?? null,
      maxGainFt: p.maxGainFt ?? null,
      difficulty: p.difficulty ?? null,
      avoidExposure: p.avoidExposure ?? null,
      dogsRequired: p.dogsRequired ?? null,
    },
  );
}

export async function getTrailPreferences(userId: string): Promise<TrailPreferences> {
  const rows = await readGraph<TrailPreferences>(
    `MATCH (u:User {userId:$userId})
     OPTIONAL MATCH (u)-[:PREFERS_TRAIL]->(tp:TrailPrefs)
     RETURN tp.maxMiles AS maxMiles, tp.maxGainFt AS maxGainFt, tp.difficulty AS difficulty,
            coalesce(tp.avoidExposure, false) AS avoidExposure, coalesce(tp.dogsRequired, false) AS dogsRequired`,
    { userId },
  );
  const r = rows[0];
  return {
    maxMiles: r?.maxMiles ?? null,
    maxGainFt: r?.maxGainFt ?? null,
    difficulty: r?.difficulty ?? null,
    avoidExposure: r?.avoidExposure ?? false,
    dogsRequired: r?.dogsRequired ?? false,
  };
}

export async function clearTrailPreferences(userId: string): Promise<void> {
  await writeGraph(`MATCH (:User {userId:$userId})-[:PREFERS_TRAIL]->(tp:TrailPrefs) DETACH DELETE tp`, { userId });
}

export type TrailSaveKind = 'saved' | 'wishlisted' | 'did';
const SAVE_REL: Record<TrailSaveKind, string> = { saved: 'SAVED', wishlisted: 'WISHLISTED', did: 'DID' };

/** Save / wishlist / record-done a trail: `(:User)-[:SAVED|WISHLISTED|DID]->(:Trail)`. The rel type comes
 *  from a fixed map (never user input), so the interpolation is safe. Returns false on an unknown trail. */
export async function saveTrail(userId: string, trailId: string, kind: TrailSaveKind = 'saved'): Promise<boolean> {
  const rows = await writeGraph<{ ok: boolean }>(
    `MATCH (tr:Trail {id:$trailId})
     MERGE (u:User {userId:$userId})
     MERGE (u)-[r:${SAVE_REL[kind]}]->(tr)
     SET r.at = datetime()
     RETURN true AS ok`,
    { userId, trailId },
  );
  return rows.length > 0;
}

export async function unsaveTrail(userId: string, trailId: string, kind: TrailSaveKind = 'saved'): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:${SAVE_REL[kind]}]->(:Trail {id:$trailId}) DELETE r`,
    { userId, trailId },
  );
}

// ── Camp memory (Campgrounds feature, Phase 3): preferences + amenity needs + saved campgrounds ────────
export interface CampPreferences {
  rig: string | null; // 'tent' | 'rv' | 'trailer' | 'van' | 'cabin'
  maxLengthFt: number | null;
  hookups: string | null; // 'none' | '30amp' | '50amp' | 'full'
  tentOk: boolean;
  ada: boolean;
  pets: boolean;
  quiet: boolean;
  budget: number | null; // max $/night
}

/**
 * Camp preferences — a single per-user `(:User)-[:PREFERS_CAMP]->(:CampPrefs {userId})` anchor (mirrors
 * `setTrailPreferences`; the `:CampPrefs` UNIQUE constraint is migration 027). Partial: a null field keeps
 * the saved value. The ranger sets these once (scope-confirmed); find_campgrounds honors them.
 */
export async function setCampPreferences(
  userId: string,
  p: {
    rig?: string | null;
    maxLengthFt?: number | null;
    hookups?: string | null;
    tentOk?: boolean | null;
    ada?: boolean | null;
    pets?: boolean | null;
    quiet?: boolean | null;
    budget?: number | null;
  },
): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[:PREFERS_CAMP]->(cp:CampPrefs {userId:$userId})
     SET cp.rig = CASE WHEN $rig IS NULL THEN cp.rig ELSE $rig END,
         cp.maxLengthFt = CASE WHEN $maxLengthFt IS NULL THEN cp.maxLengthFt ELSE toInteger($maxLengthFt) END,
         cp.hookups = CASE WHEN $hookups IS NULL THEN cp.hookups ELSE $hookups END,
         cp.tentOk = CASE WHEN $tentOk IS NULL THEN cp.tentOk ELSE $tentOk END,
         cp.ada = CASE WHEN $ada IS NULL THEN cp.ada ELSE $ada END,
         cp.pets = CASE WHEN $pets IS NULL THEN cp.pets ELSE $pets END,
         cp.quiet = CASE WHEN $quiet IS NULL THEN cp.quiet ELSE $quiet END,
         cp.budget = CASE WHEN $budget IS NULL THEN cp.budget ELSE toFloat($budget) END,
         cp.at = datetime()`,
    {
      userId,
      rig: p.rig ?? null,
      maxLengthFt: p.maxLengthFt ?? null,
      hookups: p.hookups ?? null,
      tentOk: p.tentOk ?? null,
      ada: p.ada ?? null,
      pets: p.pets ?? null,
      quiet: p.quiet ?? null,
      budget: p.budget ?? null,
    },
  );
}

export async function getCampPreferences(userId: string): Promise<CampPreferences> {
  const rows = await readGraph<CampPreferences>(
    `MATCH (u:User {userId:$userId})
     OPTIONAL MATCH (u)-[:PREFERS_CAMP]->(cp:CampPrefs)
     RETURN cp.rig AS rig, cp.maxLengthFt AS maxLengthFt, cp.hookups AS hookups,
            coalesce(cp.tentOk, false) AS tentOk, coalesce(cp.ada, false) AS ada,
            coalesce(cp.pets, false) AS pets, coalesce(cp.quiet, false) AS quiet, cp.budget AS budget`,
    { userId },
  );
  const r = rows[0];
  return {
    rig: r?.rig ?? null,
    maxLengthFt: r?.maxLengthFt ?? null,
    hookups: r?.hookups ?? null,
    tentOk: r?.tentOk ?? false,
    ada: r?.ada ?? false,
    pets: r?.pets ?? false,
    quiet: r?.quiet ?? false,
    budget: r?.budget ?? null,
  };
}

export async function clearCampPreferences(userId: string): Promise<void> {
  await writeGraph(`MATCH (:User {userId:$userId})-[:PREFERS_CAMP]->(cp:CampPrefs) DETACH DELETE cp`, { userId });
}

/** Canonical camp-amenity ids the user can require (reuses the F5 REQUIRES → :Amenity bridge so search honors them). */
export const CAMP_AMENITY_NAMES: Record<string, string> = {
  'amen:hookup-30amp': '30-amp Hookup',
  'amen:hookup-50amp': '50-amp Hookup',
  'amen:full-hookup': 'Full Hookup',
  'amen:dump-station': 'Dump Station',
  'amen:shower': 'Shower',
  'amen:potable-water': 'Potable Water',
};
export const CAMP_AMENITY_IDS = Object.keys(CAMP_AMENITY_NAMES);

/** Record camp-amenity needs as `(:User)-[:REQUIRES]->(:Amenity {camp})` (mirror of setAccessibilityNeeds). */
export async function setCampAmenityNeeds(userId: string, featureIds: string[]): Promise<string[]> {
  const valid = [...new Set(featureIds)].filter((id) => id in CAMP_AMENITY_NAMES);
  if (!valid.length) return [];
  await writeGraph(
    `MERGE (u:User {userId: $userId})
     WITH u UNWIND $ids AS aid
     MERGE (am:Amenity {id: aid}) ON CREATE SET am.name = $names[aid], am.camp = true
     MERGE (u)-[:REQUIRES]->(am)`,
    { userId, ids: valid, names: CAMP_AMENITY_NAMES },
  );
  return valid;
}

/** Save a campground: `(:User)-[:SAVED]->(:Campground)` (mirror of saveTrail). False on unknown id. */
export async function saveCampground(userId: string, campgroundId: string): Promise<boolean> {
  const rows = await writeGraph<{ ok: boolean }>(
    `MATCH (c:Campground {id:$campgroundId})
     MERGE (u:User {userId:$userId})
     MERGE (u)-[r:SAVED]->(c) SET r.at = datetime()
     RETURN true AS ok`,
    { userId, campgroundId },
  );
  return rows.length > 0;
}

export async function unsaveCampground(userId: string, campgroundId: string): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:SAVED]->(:Campground {id:$campgroundId}) DELETE r`,
    { userId, campgroundId },
  );
}

export interface HomeLocation {
  latitude: number;
  longitude: number;
  label: string;
  source: 'geocode' | 'geolocation';
}

/**
 * Home location — a single per-user `(:User)-[:LIVES_AT]->(:Home {userId})` anchor (migration 028,
 * mirrors the :TrailPrefs/:CampPrefs pattern). Durable personal data: the ranger confirms before saving
 * (set_home_location scope rule), and /me can edit or clear it. Feeds the trip-origin default,
 * the memory block, distance-from-home ranking, and the /map home pin.
 */
export async function setHomeLocation(userId: string, home: HomeLocation): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[:LIVES_AT]->(h:Home {userId:$userId})
     SET h.location = point({latitude: $latitude, longitude: $longitude}),
         h.label = $label, h.source = $source, h.at = datetime()`,
    { userId, latitude: home.latitude, longitude: home.longitude, label: home.label, source: home.source },
  );
}

export async function getHomeLocation(userId: string): Promise<HomeLocation | null> {
  const rows = await readGraph<HomeLocation>(
    `MATCH (:User {userId:$userId})-[:LIVES_AT]->(h:Home)
     RETURN h.location.latitude AS latitude, h.location.longitude AS longitude,
            h.label AS label, h.source AS source`,
    { userId },
  );
  const r = rows[0];
  return r && r.latitude != null ? r : null;
}

export async function clearHomeLocation(userId: string): Promise<void> {
  await writeGraph(`MATCH (:User {userId:$userId})-[:LIVES_AT]->(h:Home) DETACH DELETE h`, { userId });
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
 * Remove a single durable accessibility/amenity need (P0.5 — per-row removal on /me): drop one
 * `(:User)-[:REQUIRES]->(:Amenity {name})` edge by amenity name. Amenity needs are set explicitly
 * (set_travel_constraints / set_accessibility_needs), not auto-extracted from chat, so a plain edge
 * delete suffices — no tombstone needed. Leaves the TRAVELS_WITH wheelchair/RV constraint untouched.
 */
export async function removeRequiredAmenity(userId: string, name: string): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[r:REQUIRES]->(:Amenity {name:$name}) DELETE r`,
    { userId, name },
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
