import { describe, it, expect, vi, beforeEach } from 'vitest';

// rankParks' filter/score logic is Cypher; mock the driver boundary and assert the generated query +
// params (matches the unit convention in queries.test.ts). bridges is mocked so its NAMS/driver imports
// don't load (rankParks itself takes constraints as params; only the API route reads getTravelConstraints).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./bridges', () => ({ getTravelConstraints: vi.fn() }));

import { rankParks, resolveRankParams, clampNum } from './recommend';
import { readGraph } from './neo4j';

const mockRead = vi.mocked(readGraph);

describe('rankParks (live constraint re-ranking, ADR-046)', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue([] as never);
  });

  it('emits the hard filters + crowd-tolerance soft boost and binds the params', async () => {
    await rankParks({
      userId: 'u1',
      maxBortle: 2,
      crowdTolerance: 0.8,
      rvMaxLengthFt: 22,
      wheelchairAccessible: true,
      requiredAmenities: ['Restrooms'],
      stateCode: 'UT',
      limit: 10,
      offset: 0,
    });
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    // hard filters
    expect(q).toContain('coalesce(p.bortleScale, 99) <= $maxBortle');
    expect(q).toContain('cg.rvMaxLengthFt >= $rv');
    expect(q).toContain('cg.wheelchairAccessible = true');
    expect(q).toContain('(p)-[:LOCATED_IN]->(:State {code:$stateCode})');
    // soft preference join must be OPTIONAL so cold-start parks still appear (score 0)
    expect(q).toContain('OPTIONAL MATCH (u:User {userId:$userId})-[pr:PREFERS]->(d)');
    // crowd tolerance is a SIGNED adjustment over the existing crowdLevel: quiet parks gain, busy
    // parks are penalized (so the slider visibly demotes crowded parks, not just nudges quiet ones up).
    expect(q).toMatch(/CASE p\.crowdLevel WHEN 'low' THEN 2 WHEN 'moderate' THEN 1 WHEN 'high' THEN -2 WHEN 'very high' THEN -4 ELSE 0 END/);
    expect(q).toContain('coalesce($crowdTolerance, 0.0)');
    expect(params).toMatchObject({
      userId: 'u1',
      rv: 22,
      wheelchair: true,
      required: ['Restrooms'],
      maxBortle: 2,
      crowdTolerance: 0.8,
      stateCode: 'UT',
      limit: 10,
      offset: 0,
    });
  });

  it('passes null filters and supports anonymous cold-start (no userId)', async () => {
    await rankParks({});
    const [, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ userId: null, rv: null, maxBortle: null, crowdTolerance: null, wheelchair: false });
  });

  it('returns items + a separate total count', async () => {
    mockRead
      .mockResolvedValueOnce([{ parkCode: 'grca' }, { parkCode: 'glac' }] as never)
      .mockResolvedValueOnce([{ total: 42 }] as never);
    const { items, total } = await rankParks({});
    expect(items).toHaveLength(2);
    expect(total).toBe(42);
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});

describe('clampNum', () => {
  it('clamps to range and rejects non-numbers', () => {
    expect(clampNum(5, 1, 9)).toBe(5);
    expect(clampNum(0, 1, 9)).toBe(1);
    expect(clampNum(99, 1, 9)).toBe(9);
    expect(clampNum('x', 1, 9)).toBeUndefined();
    expect(clampNum(Number.NaN, 1, 9)).toBeUndefined();
    expect(clampNum(undefined, 1, 9)).toBeUndefined();
  });
});

describe('resolveRankParams (rank API merge + clamps)', () => {
  const cons = { wheelchair: true, rvMaxLengthFt: 22, requiredAmenities: ['Restrooms'] };

  it('falls back to the saved travel constraints when the body omits them', () => {
    const p = resolveRankParams({}, cons, 'u1');
    expect(p).toMatchObject({
      userId: 'u1',
      rvMaxLengthFt: 22,
      wheelchairAccessible: true,
      requiredAmenities: ['Restrooms'],
      maxBortle: null,
      crowdTolerance: null,
      limit: 24,
      offset: 0,
    });
  });

  it('body overrides saved constraints; rvMaxLengthFt <= 0 means "off" (null)', () => {
    const p = resolveRankParams({ rvMaxLengthFt: 0, wheelchairAccessible: false, requiredAmenities: [] }, cons, 'u1');
    expect(p.rvMaxLengthFt).toBeNull();
    expect(p.wheelchairAccessible).toBe(false);
    expect(p.requiredAmenities).toEqual([]);
  });

  it('minBortle aliases maxBortle (darker = lower) and clamps to 1..9; maxBortle wins when both sent', () => {
    expect(resolveRankParams({ minBortle: 2 }, cons, null).maxBortle).toBe(2);
    expect(resolveRankParams({ maxBortle: 99 }, cons, null).maxBortle).toBe(9);
    expect(resolveRankParams({ maxBortle: 5, minBortle: 2 }, cons, null).maxBortle).toBe(5);
  });

  it('clamps crowdTolerance 0..1, limit 1..48, offset >= 0', () => {
    const p = resolveRankParams({ crowdTolerance: 5, limit: 1000, offset: -3 }, cons, null);
    expect(p.crowdTolerance).toBe(1);
    expect(p.limit).toBe(48);
    expect(p.offset).toBe(0);
  });

  it('carries an anonymous (null) userId through', () => {
    expect(resolveRankParams({}, cons, null).userId).toBeNull();
  });
});
