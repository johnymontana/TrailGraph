import { describe, it, expect, vi, beforeEach } from 'vitest';

// rankParks' filter/score logic is Cypher; mock the driver boundary and assert the generated query +
// params (matches the unit convention in queries.test.ts). bridges is mocked so its NAMS/driver imports
// don't load (rankParks itself takes constraints as params; only the API route reads getTravelConstraints).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./bridges', () => ({ getTravelConstraints: vi.fn() }));

import { rankParks } from './recommend';
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
    // crowd-tolerance boost over the existing crowdLevel
    expect(q).toMatch(/CASE p\.crowdLevel WHEN 'low' THEN 3 WHEN 'moderate' THEN 2 WHEN 'high' THEN 1 ELSE 0 END/);
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
