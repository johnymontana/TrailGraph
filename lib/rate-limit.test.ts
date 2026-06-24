import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-logic unit test: mock the Neo4j boundary so the limiter's window math + key/ip parsing are
// exercised without a real DB (matches lib/queries.test.ts).
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { rateLimit, peekRateLimit, dailyQuota, rlUser, rlIp, clientIpFrom, isClamped, tripRunaway, pruneRateBuckets } from './rate-limit';
import { readGraph, writeGraph } from './neo4j';

const mockWrite = vi.mocked(writeGraph);
const mockRead = vi.mocked(readGraph);

beforeEach(() => {
  mockWrite.mockReset();
  mockRead.mockReset();
});

describe('rateLimit (Neo4j fixed-window)', () => {
  it('allows when count <= limit and reports remaining + resetAt', async () => {
    mockWrite.mockResolvedValue([{ count: 3, resetAt: 1000 }] as never);
    const r = await rateLimit('k', 5, 60);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(1000);
  });

  it('blocks when count exceeds limit', async () => {
    mockWrite.mockResolvedValue([{ count: 6, resetAt: 1000 }] as never);
    const r = await rateLimit('k', 5, 60);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('passes windowMs = windowSec * 1000 to the query', async () => {
    mockWrite.mockResolvedValue([{ count: 1, resetAt: 0 }] as never);
    await rateLimit('k', 5, 60);
    const [, params] = mockWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ key: 'k', windowMs: 60_000 });
  });

  it('allows exactly `limit` hits then blocks (no off-by-one)', async () => {
    for (let i = 1; i <= 6; i++) {
      mockWrite.mockResolvedValueOnce([{ count: i, resetAt: 1000 }] as never);
      const r = await rateLimit('k', 5, 60);
      expect(r.ok).toBe(i <= 5); // counts 1..5 allowed, 6 blocked
    }
  });

  it('peek and rateLimit agree at the boundary', async () => {
    // After `limit` real hits the bucket count == limit; peek must report the NEXT hit as not allowed.
    mockRead.mockResolvedValue([{ count: 5, resetAt: 1000 }] as never);
    const peeked = await peekRateLimit('k', 5, 60);
    expect(peeked.ok).toBe(false); // next (6th) hit would be blocked — matches rateLimit
    expect(peeked.remaining).toBe(0);
  });
});

describe('peekRateLimit', () => {
  it('reads current count without writing', async () => {
    mockRead.mockResolvedValue([{ count: 2, resetAt: 9 }] as never);
    const r = await peekRateLimit('k', 5, 86_400);
    expect(r.remaining).toBe(3);
    expect(r.ok).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('dailyQuota', () => {
  it('uses an 86400s (24h) window', async () => {
    mockWrite.mockResolvedValue([{ count: 1, resetAt: 0 }] as never);
    await dailyQuota('k', 150);
    const [, params] = mockWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ windowMs: 86_400_000 });
  });
});

describe('key builders + clientIpFrom', () => {
  it('builds scoped user keys and per-route ip keys', () => {
    expect(rlUser('abc')).toBe('u:agent:abc');
    expect(rlUser('abc', 'agent:day')).toBe('u:agent:day:abc');
    expect(rlIp('1.2.3.4', 'vibe')).toBe('ip:vibe:1.2.3.4');
  });

  it('parses x-forwarded-for (first ip), then x-real-ip, then unknown', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('9.9.9.9');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});

describe('isClamped', () => {
  it('returns the clamp flag from the graph', async () => {
    mockRead.mockResolvedValue([{ clamped: true }] as never);
    expect(await isClamped('u')).toBe(true);
    mockRead.mockResolvedValue([{ clamped: false }] as never);
    expect(await isClamped('u')).toBe(false);
  });

  it('defaults to not-clamped when the graph returns nothing', async () => {
    mockRead.mockResolvedValue([] as never);
    expect(await isClamped('u')).toBe(false);
  });
});

describe('tripRunaway', () => {
  it('upserts an :AgentClamp for the user with a future expiry', async () => {
    mockWrite.mockResolvedValue([] as never);
    await tripRunaway('user-1');
    const [cypher, params] = mockWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain('AgentClamp');
    expect(cypher).toContain('c.until = timestamp() + toInteger($ms)');
    expect(params).toMatchObject({ userId: 'user-1' });
    expect(params.ms).toBeGreaterThan(0);
  });
});

describe('pruneRateBuckets', () => {
  it('returns the number of expired buckets deleted', async () => {
    mockWrite.mockResolvedValue([{ deleted: 7 }] as never);
    expect(await pruneRateBuckets()).toBe(7);
    const [cypher] = mockWrite.mock.calls[0] as [string];
    expect(cypher).toContain('b.expiresAt < timestamp()');
  });

  it('returns 0 when nothing is expired', async () => {
    mockWrite.mockResolvedValue([] as never);
    expect(await pruneRateBuckets()).toBe(0);
  });
});
