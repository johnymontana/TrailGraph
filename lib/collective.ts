import { readGraph, writeGraph } from './neo4j';

/**
 * Opt-in collective intelligence (E5): "travelers like you also loved…". Anonymized aggregate over the
 * shared graph — only users who opted in (`:User.shareCollective = true`) participate, and results are
 * counts of parks, never identities (§13.4). This is the cross-user payoff of the single-instance
 * design: similarity (shared PREFERS) + recommendation in one traversal.
 */

export async function setCollectiveOptIn(userId: string, optIn: boolean): Promise<void> {
  await writeGraph(`MERGE (u:User {userId:$userId}) SET u.shareCollective = $optIn`, { userId, optIn });
}

export async function getCollectiveOptIn(userId: string): Promise<boolean> {
  const rows = await readGraph<{ optIn: boolean }>(
    `MATCH (u:User {userId:$userId}) RETURN coalesce(u.shareCollective, false) AS optIn`,
    { userId },
  );
  return rows[0]?.optIn ?? false;
}

export interface CollectivePick {
  parkCode: string;
  name: string;
  travelers: number; // how many similar opted-in travelers considered/planned it
  lat?: number | null; // for the map "travelers like you" overlay (#6)
  lng?: number | null;
}

/**
 * Parks favored by opted-in travelers who share ≥1 canonical preference with this user, excluding
 * parks the user already considered/planned. Returns anonymized counts only. Empty unless the user
 * has opted in (we don't expose collective data to non-participants).
 */
export async function travelersAlsoLoved(userId: string, limit = 8): Promise<CollectivePick[]> {
  if (!(await getCollectiveOptIn(userId))) return [];
  return readGraph<CollectivePick>(
    `
    MATCH (me:User {userId:$userId})-[:PREFERS]->()<-[:PREFERS]-(other:User)
    WHERE other.userId <> $userId AND other.shareCollective = true
    WITH DISTINCT me, other
    MATCH (p:Park)
    WHERE ( (other)-[:CONSIDERED]->(p)
            OR EXISTS { (other)-[:PLANNED]->(:Trip)-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p) } )
      AND NOT (me)-[:CONSIDERED]->(p)
      AND NOT EXISTS { (me)-[:PLANNED]->(:Trip)-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p) }
    WITH p, count(DISTINCT other) AS travelers
    RETURN p.parkCode AS parkCode, p.fullName AS name, travelers,
           p.location.latitude AS lat, p.location.longitude AS lng
    ORDER BY travelers DESC, name ASC
    LIMIT toInteger($limit)
    `,
    { userId, limit },
  );
}

export interface CollectiveTrail {
  id: string;
  name: string;
  parkCode: string | null;
  parkName: string | null;
  difficulty: string | null;
  lengthMiles: number | null;
  hikers: number; // how many similar opted-in hikers did it
}

/**
 * "Hikers like you also did…" (ADR-072, Phase 4) — trails DONE by opted-in users who share ≥1 trail with
 * this user (via DID/SAVED), excluding trails the user already did/saved. The trail-graph analogue of
 * `travelersAlsoLoved`: anonymized counts only, opt-in gated (no collective data for non-participants).
 */
export async function trailsHikersAlsoDid(userId: string, limit = 8): Promise<CollectiveTrail[]> {
  if (!(await getCollectiveOptIn(userId))) return [];
  return readGraph<CollectiveTrail>(
    `
    MATCH (me:User {userId:$userId})-[:DID|SAVED]->(:Trail)<-[:DID|SAVED]-(other:User)
    WHERE other.userId <> $userId AND other.shareCollective = true
    WITH DISTINCT me, other
    MATCH (other)-[:DID]->(t:Trail)
    WHERE NOT (me)-[:DID|SAVED]->(t)
    OPTIONAL MATCH (t)-[:IN_PARK]->(p:Park)
    WITH t, p, count(DISTINCT other) AS hikers
    RETURN t.id AS id, t.name AS name, t.parkCode AS parkCode, p.fullName AS parkName,
           t.difficulty AS difficulty, t.lengthMiles AS lengthMiles, hikers
    ORDER BY hikers DESC, t.name ASC
    LIMIT toInteger($limit)
    `,
    { userId, limit },
  );
}
