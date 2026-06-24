import { readGraph, writeGraph } from './neo4j';

/**
 * Neo4j-backed fixed-window rate limiter (audit C1/C5/C6; ADR-002: one canonical datastore — no new
 * external service). Each (key, window-index) is a :RateBucket node; the `MERGE`+increment runs in one
 * write transaction, and MERGE takes a node lock, so concurrent requests to the same key count
 * correctly — they serialize on that one bucket node (the hot key is exactly the caller being limited).
 * The extra per-request write is acceptable at this app's scale; profile and move to Redis only if the
 * hot path becomes a bottleneck.
 *
 * Time is server-authoritative via Cypher `timestamp()` (epoch ms). With the driver's
 * disableLosslessIntegers (lib/neo4j.ts), counts/timestamps come back as plain JS numbers.
 */

export interface RateLimitResult {
  /** false once the count for the current window exceeds `limit`. */
  ok: boolean;
  /** Requests left in the current window (never negative). */
  remaining: number;
  /** Epoch ms when the current window rolls over. */
  resetAt: number;
}

/**
 * Count one hit against `key` and report whether it stays within `limit` per `windowSec`.
 * Fixed window: the bucket id is (key, floor(now/window)), so a window rolls cleanly with no sweep.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const windowMs = windowSec * 1000;
  const rows = await writeGraph<{ count: number; resetAt: number }>(
    `WITH timestamp() AS now, toInteger($windowMs) AS w
     WITH now, w, now / w AS widx
     MERGE (b:RateBucket {key: $key, widx: widx})
       ON CREATE SET b.count = 0, b.expiresAt = (widx + 1) * w
     SET b.count = b.count + 1
     RETURN b.count AS count, (widx + 1) * w AS resetAt`,
    { key, windowMs },
  );
  const count = rows[0]?.count ?? 1;
  const resetAt = rows[0]?.resetAt ?? Date.now() + windowMs;
  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

/** Convenience: a 24-hour fixed-window quota (per-user daily turn cap, etc.). */
export function dailyQuota(key: string, limit: number): Promise<RateLimitResult> {
  return rateLimit(key, limit, 86_400);
}

/** Agent channel quotas (audit C1), shared by the channel gate and the /api/usage peek. */
export const AGENT_PER_MINUTE = 10;
export const AGENT_PER_DAY = 150;

/**
 * Read the current usage for `key` WITHOUT counting a hit — for surfacing remaining quota in the UI.
 * `ok` reflects whether the next hit would be allowed.
 */
export async function peekRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const windowMs = windowSec * 1000;
  const rows = await readGraph<{ count: number; resetAt: number }>(
    `WITH timestamp() AS now, toInteger($windowMs) AS w
     WITH now, w, now / w AS widx
     OPTIONAL MATCH (b:RateBucket {key: $key, widx: widx})
     RETURN coalesce(b.count, 0) AS count, (widx + 1) * w AS resetAt`,
    { key, windowMs },
  );
  const count = rows[0]?.count ?? 0;
  const resetAt = rows[0]?.resetAt ?? Date.now() + windowMs;
  return { ok: count < limit, remaining: Math.max(0, limit - count), resetAt };
}

/** Key for a per-user (server-derived principalId) limit. `scope` separates per-minute vs per-day, etc. */
export const rlUser = (id: string, scope = 'agent'): string => `u:${scope}:${id}`;

/** Key for a per-IP limit on a named route. */
export const rlIp = (ip: string, route: string): string => `ip:${route}:${ip}`;

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIpFrom(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export const clientIp = (req: Request): string => clientIpFrom(req.headers);

/**
 * Drop expired buckets so :RateBucket doesn't grow unbounded. Bounded per call (LIMIT) so it never
 * runs long inside a cron; call it from the daily digest cron. Returns the number deleted.
 */
export async function pruneRateBuckets(): Promise<number> {
  const rows = await writeGraph<{ deleted: number }>(
    `MATCH (b:RateBucket) WHERE b.expiresAt < timestamp()
     WITH b LIMIT 20000
     DETACH DELETE b
     RETURN count(b) AS deleted`,
  );
  return rows[0]?.deleted ?? 0;
}

const CLAMP_MS = 60 * 60 * 1000; // 1 hour

/**
 * Runaway-turn clamp (C2). Eve hooks are observe-only and cannot abort an in-flight turn, so when a
 * single turn blows past the per-turn tool-call cap we flag the user here; the next message is rejected
 * by the channel onMessage until `until` passes. Caps a pathological turn at "this turn + clamp forward."
 */
export async function tripRunaway(userId: string): Promise<void> {
  await writeGraph(
    `MERGE (c:AgentClamp {userId: $userId}) SET c.until = timestamp() + toInteger($ms)`,
    { userId, ms: CLAMP_MS },
  );
}

/** Whether the user is currently clamped (set by tripRunaway). */
export async function isClamped(userId: string): Promise<boolean> {
  const rows = await readGraph<{ clamped: boolean }>(
    `OPTIONAL MATCH (c:AgentClamp {userId: $userId})
     RETURN coalesce(c.until, 0) > timestamp() AS clamped`,
    { userId },
  );
  return rows[0]?.clamped ?? false;
}
