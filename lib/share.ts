import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { getTrip } from './trips';

/**
 * Shareable trips (C6 read-only, F4 role-based). A `:ShareLink {token, role}` hangs off the trip; the
 * token grants token-scoped access without auth (read-only page). Owner verified on create/revoke (R4).
 */
export type ShareRole = 'read' | 'edit';

export async function createShareLink(userId: string, tripId: string, role: ShareRole): Promise<string | null> {
  const owns = await readGraph<{ ok: boolean }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId}) RETURN true AS ok`,
    { userId, tripId },
  );
  if (!owns.length) return null;
  const token = randomUUID().replace(/-/g, '');
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})
     CREATE (sl:ShareLink {token:$token, role:$role, createdAt:datetime()})
     MERGE (t)-[:SHARED_VIA]->(sl)`,
    { userId, tripId, token, role },
  );
  return token;
}

export async function listShareLinks(userId: string, tripId: string) {
  return readGraph<{ token: string; role: ShareRole; createdAt: string }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:SHARED_VIA]->(sl:ShareLink)
     RETURN sl.token AS token, sl.role AS role, toString(sl.createdAt) AS createdAt
     ORDER BY sl.createdAt DESC`,
    { userId, tripId },
  );
}

export async function revokeShareLink(userId: string, tripId: string, token: string): Promise<void> {
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:SHARED_VIA]->(sl:ShareLink {token:$token}) DETACH DELETE sl`,
    { userId, tripId, token },
  );
}

/** Public, token-scoped read (no auth). The token resolves to its owner, then we read the owner's trip. */
export async function getSharedTrip(token: string): Promise<{ trip: NonNullable<Awaited<ReturnType<typeof getTrip>>>; role: ShareRole } | null> {
  const rows = await readGraph<{ tripId: string; ownerId: string; role: ShareRole }>(
    `MATCH (sl:ShareLink {token:$token})<-[:SHARED_VIA]-(t:Trip)
     RETURN t.id AS tripId, t.userId AS ownerId, sl.role AS role`,
    { token },
  );
  if (!rows.length) return null;
  const { tripId, ownerId, role } = rows[0];
  const trip = await getTrip(ownerId, tripId);
  return trip ? { trip, role } : null;
}
