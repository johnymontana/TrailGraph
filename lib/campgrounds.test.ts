import { describe, it, expect, vi, beforeEach } from 'vitest';

// campgrounds.ts imports the Neo4j driver boundary at module load; mock it so this pure-logic unit test
// asserts the generated Cypher + params shape without touching a real DB (matches lib/queries.test.ts).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));

import { searchCampgrounds, bookingWindowOpenDate, bookingUrlFor } from './campgrounds';
import { readGraph } from './neo4j';

describe('bookingWindowOpenDate', () => {
  it('subtracts the rolling window from the arrival date', () => {
    const r = bookingWindowOpenDate('2026-09-15', 6, '2026-01-01');
    expect(r.windowOpensOn).toBe('2026-03-15');
    expect(r.opensInPast).toBe(false);
    expect(r.daysUntilOpen).toBeGreaterThan(0);
  });
  it('flags a window that already opened', () => {
    const r = bookingWindowOpenDate('2026-02-01', 6, '2026-01-15');
    expect(r.windowOpensOn).toBe('2025-08-01');
    expect(r.opensInPast).toBe(true);
    expect(r.daysUntilOpen).toBeLessThanOrEqual(0);
  });
});

describe('bookingUrlFor', () => {
  it('prefers the reservationUrl, falls back to a recreation.gov link, else null', () => {
    expect(bookingUrlFor({ reservationUrl: 'https://x', ridbId: '1' })).toBe('https://x');
    expect(bookingUrlFor({ reservationUrl: null, ridbId: '232449' })).toContain('recreation.gov/camping/campgrounds/232449');
    expect(bookingUrlFor({ reservationUrl: null, ridbId: null })).toBeNull();
  });
});

const mockRead = vi.mocked(readGraph);

beforeEach(() => {
  mockRead.mockReset();
  // searchCampgrounds calls readGraph twice (items, then count) — default both to empty/zero.
  mockRead.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
});

describe('searchCampgrounds — Cypher + params', () => {
  it('builds a plain MATCH (no fulltext) with no filters', async () => {
    await searchCampgrounds({});
    const [cypher, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain('MATCH (c:Campground)');
    expect(cypher).not.toContain('campground_fulltext');
    expect(cypher).toContain('SKIP toInteger($offset) LIMIT toInteger($limit)');
    expect(params).toMatchObject({ q: null, limit: 24, offset: 0, nearParkCode: null });
  });

  it('switches to the fulltext index when q is given (sanitized + prefix-wildcarded)', async () => {
    await searchCampgrounds({ q: 'upper pines' });
    const [cypher, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain("db.index.fulltext.queryNodes('campground_fulltext', $q)");
    expect(params.q).toBe('upper* pines*');
  });

  it('emits agency / dispersed / siteType / amps / ada predicates only when set', async () => {
    await searchCampgrounds({ agency: 'USFS', dispersed: true, siteType: 'tent', minAmps: 30, ada: true });
    const [cypher] = mockRead.mock.calls[0];
    expect(cypher).toContain('c.agency = $agency');
    expect(cypher).toContain('coalesce(c.dispersed, false) = true');
    expect(cypher).toContain('(c)-[:HAS_SITE]->(s:Campsite) WHERE s.type = $siteType');
    expect(cypher).toContain('coalesce(s.electricAmps, 0) >= $minAmps');
    expect(cypher).toContain('s.ada = true');
  });

  it('nearParkCode matches IN_PARK OR NEAR and orders by distance', async () => {
    await searchCampgrounds({ nearParkCode: 'yose' });
    const [cypher, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain('(c)-[:IN_PARK]->(:Park {parkCode: $nearParkCode})');
    expect(cypher).toContain('(c)-[:NEAR]->(:Park {parkCode: $nearParkCode})');
    expect(cypher).toContain('ORDER BY distanceMiles ASC');
    expect(params.nearParkCode).toBe('yose');
  });

  it('hasRidb narrows to the availability candidate set', async () => {
    await searchCampgrounds({ hasRidb: true });
    expect(mockRead.mock.calls[0][0]).toContain('c.ridbId IS NOT NULL');
  });

  it('normalizes maxAmps 0 → null', async () => {
    mockRead.mockReset();
    mockRead
      .mockResolvedValueOnce([{ id: 'a', name: 'A', maxAmps: 0 } as never])
      .mockResolvedValueOnce([{ total: 1 }]);
    const { items } = await searchCampgrounds({});
    expect(items[0].maxAmps).toBeNull();
  });
});
