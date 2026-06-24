import { afterAll, beforeEach, expect, it } from 'vitest';
import { describeIntegration } from './db';
import { rateLimit, peekRateLimit, isClamped, tripRunaway, pruneRateBuckets } from '../../lib/rate-limit';
import { readGraph, writeGraph, closeDriver } from '../../lib/neo4j';

/**
 * Real-Neo4j checks for the fixed-window limiter (audit C1/C5/C6). Needs the 007 migration applied
 * (CI runs `pnpm db:migrate`). Each test isolates by a unique key so it never collides with others.
 */
describeIntegration('rate limiter (Neo4j fixed-window)', () => {
  const key = `itest:${Math.random().toString(36).slice(2)}`;
  const clampUser = `itest-user:${Math.random().toString(36).slice(2)}`;

  beforeEach(async () => {
    await writeGraph(`MATCH (b:RateBucket) WHERE b.key STARTS WITH 'itest:' DETACH DELETE b`);
    await writeGraph(`MATCH (c:AgentClamp) WHERE c.userId STARTS WITH 'itest-user:' DETACH DELETE c`);
  });

  afterAll(async () => {
    await writeGraph(`MATCH (b:RateBucket) WHERE b.key STARTS WITH 'itest:' DETACH DELETE b`);
    await writeGraph(`MATCH (c:AgentClamp) WHERE c.userId STARTS WITH 'itest-user:' DETACH DELETE c`);
    await closeDriver();
  });

  it('counts hits and blocks once the limit is exceeded', async () => {
    const limit = 3;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(key, limit, 60));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[0].remaining).toBe(2);
    // peek must not advance the counter
    const before = await peekRateLimit(key, limit, 60);
    const after = await peekRateLimit(key, limit, 60);
    expect(before.remaining).toBe(after.remaining);
  });

  it('tripRunaway clamps a user; pruning leaves live buckets intact', async () => {
    expect(await isClamped(clampUser)).toBe(false);
    await tripRunaway(clampUser);
    expect(await isClamped(clampUser)).toBe(true);
    // a fresh bucket is not expired, so prune must not delete it
    await rateLimit(key, 5, 60);
    await pruneRateBuckets();
    const peeked = await peekRateLimit(key, 5, 60);
    expect(peeked.remaining).toBeLessThan(5);
  });

  it('pruneRateBuckets deletes expired buckets but keeps live ones', async () => {
    // an already-expired bucket and a live one
    await writeGraph(
      `CREATE (:RateBucket {key:'itest:expired', widx: 1, count: 1, expiresAt: timestamp() - 1000})`,
    );
    await rateLimit('itest:livekey', 5, 60); // live bucket (expiresAt in the future)
    const deleted = await pruneRateBuckets();
    expect(deleted).toBeGreaterThanOrEqual(1);
    const expired = await readGraph(`MATCH (b:RateBucket {key:'itest:expired'}) RETURN b`);
    expect(expired.length).toBe(0); // gone
    const live = await readGraph(`MATCH (b:RateBucket {key:'itest:livekey'}) RETURN b`);
    expect(live.length).toBe(1); // survives
  });
});
