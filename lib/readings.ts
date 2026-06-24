import { readGraph, writeGraph } from './neo4j';

/**
 * Community sky-darkness readings (Collective Intelligence v2, ADR-053). Users submit their own SQM
 * (sky quality meter, mag/arcsec²) readings; the leaderboard ranks parks by the MEDIAN community
 * reading. Privacy-first: gated behind the existing `shareCollective` opt-in and fully anonymized
 * (counts + medians, never identities). One reading per user per park per night (re-submit updates).
 */

export const SQM_MIN = 16; // bright urban sky
export const SQM_MAX = 22; // pristine, near the darkest measurable

/** Validate a submitted SQM value. Pure (unit-tested). */
export function validateSqm(sqm: number): { ok: boolean; error?: string } {
  if (typeof sqm !== 'number' || Number.isNaN(sqm)) return { ok: false, error: 'SQM must be a number.' };
  if (sqm < SQM_MIN || sqm > SQM_MAX) return { ok: false, error: `SQM must be between ${SQM_MIN} and ${SQM_MAX} (mag/arcsec²).` };
  return { ok: true };
}

export interface SubmitReadingResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Record (or update) a user's SQM reading for a park on a given night. Validates the value and that the
 * park exists; dedupes by user+park+night so re-submitting corrects rather than duplicates. userId
 * server-bound (R4). The reading only feeds the public leaderboard if the user has opted in.
 */
export async function submitReading(
  userId: string,
  parkCode: string,
  sqm: number,
  takenAt?: string,
  lat?: number,
  lng?: number,
): Promise<SubmitReadingResult> {
  const v = validateSqm(sqm);
  if (!v.ok) return { ok: false, error: v.error };
  const taken = (takenAt ?? new Date().toISOString()).slice(0, 10);

  const rows = await writeGraph<{ id: string }>(
    `
    MATCH (p:Park {parkCode:$parkCode})
    MERGE (u:User {userId:$userId})
    MERGE (u)-[:SUBMITTED]->(r:UserReading {userId:$userId, parkCode:$parkCode, night:$taken})
      ON CREATE SET r.id = randomUUID(), r.createdAt = datetime()
    SET r.sqm = $sqm, r.takenAt = $taken,
        r.location = CASE WHEN $lat IS NOT NULL AND $lng IS NOT NULL THEN point({latitude:$lat, longitude:$lng}) ELSE null END
    MERGE (r)-[:AT_PARK]->(p)
    RETURN r.id AS id
    `,
    { userId, parkCode, sqm, taken, lat: lat ?? null, lng: lng ?? null },
  );
  if (!rows.length) return { ok: false, error: `No such park: ${parkCode}.` };
  return { ok: true, id: rows[0].id };
}

export interface LeaderboardEntry {
  parkCode: string;
  name: string;
  bortle: number | null;
  medianSqm: number;
  readings: number;
  contributors: number;
}

/**
 * Community SQM leaderboard — parks ranked by the MEDIAN reading from opted-in travelers (darker = higher
 * SQM). Anonymized aggregate only. Empty until people submit readings.
 */
export async function skyLeaderboard(limit = 12): Promise<LeaderboardEntry[]> {
  return readGraph<LeaderboardEntry>(
    `
    MATCH (u:User)-[:SUBMITTED]->(r:UserReading)-[:AT_PARK]->(p:Park)
    WHERE u.shareCollective = true AND r.sqm IS NOT NULL
    WITH p, percentileCont(r.sqm, 0.5) AS medianSqm, count(r) AS readings, count(DISTINCT u) AS contributors
    RETURN p.parkCode AS parkCode, p.fullName AS name, p.bortleScale AS bortle,
           round(medianSqm * 100) / 100 AS medianSqm, readings, contributors
    ORDER BY medianSqm DESC, readings DESC
    LIMIT toInteger($limit)
    `,
    { limit },
  );
}

export interface MyReading {
  id: string;
  parkCode: string;
  parkName: string;
  sqm: number;
  takenAt: string;
}

/** The caller's own submitted readings (for the /me panel). userId-scoped (R4). */
export async function myReadings(userId: string): Promise<MyReading[]> {
  return readGraph<MyReading>(
    `
    MATCH (u:User {userId:$userId})-[:SUBMITTED]->(r:UserReading)-[:AT_PARK]->(p:Park)
    RETURN r.id AS id, r.parkCode AS parkCode, p.fullName AS parkName, r.sqm AS sqm, r.takenAt AS takenAt
    ORDER BY r.takenAt DESC
    LIMIT 50
    `,
    { userId },
  );
}
