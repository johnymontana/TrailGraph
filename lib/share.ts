import './server-guard'; // server-only (graph writes, token minting); block client-bundle import (S9)
import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { getTrip } from './trips';

/**
 * Shareable trips (C6 read-only). A `:ShareLink {token}` hangs off the trip; the 122-bit token grants
 * token-scoped read access without auth. Owner verified on create/revoke (R4). Links expire after
 * SHARE_TTL_DAYS (audit S6) so a once-leaked link doesn't live forever. The `edit` role was removed
 * (S7): no write path ever consumed it, and a persisted-but-unenforced role is a latent IDOR.
 */
export type ShareRole = 'read';

const SHARE_TTL_DAYS = 30;

export async function createShareLink(userId: string, tripId: string, _role: ShareRole = 'read'): Promise<string | null> {
  const owns = await readGraph<{ ok: boolean }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId}) RETURN true AS ok`,
    { userId, tripId },
  );
  if (!owns.length) return null;
  const token = randomUUID().replace(/-/g, '');
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})
     CREATE (sl:ShareLink {token:$token, role:'read', createdAt:datetime(),
                           expiresAt: datetime() + duration({days: $ttlDays})})
     MERGE (t)-[:SHARED_VIA]->(sl)`,
    { userId, tripId, token, ttlDays: SHARE_TTL_DAYS },
  );
  return token;
}

export async function listShareLinks(userId: string, tripId: string) {
  return readGraph<{ token: string; role: ShareRole; createdAt: string; expiresAt: string | null }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:SHARED_VIA]->(sl:ShareLink)
     RETURN sl.token AS token, 'read' AS role, toString(sl.createdAt) AS createdAt,
            toString(sl.expiresAt) AS expiresAt
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
  const rows = await readGraph<{ tripId: string; ownerId: string }>(
    // Expired links (S6) resolve to nothing. Legacy links predating expiresAt (NULL) stay valid.
    `MATCH (sl:ShareLink {token:$token})<-[:SHARED_VIA]-(t:Trip)
     WHERE sl.expiresAt IS NULL OR sl.expiresAt > datetime()
     RETURN t.id AS tripId, t.userId AS ownerId`,
    { token },
  );
  if (!rows.length) return null;
  const { tripId, ownerId } = rows[0];
  const trip = await getTrip(ownerId, tripId);
  return trip ? { trip, role: 'read' } : null;
}
