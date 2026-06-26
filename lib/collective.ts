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
