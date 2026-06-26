import { describe, it, expect, vi, beforeEach } from 'vitest';

// rankParks' filter/score logic is Cypher; mock the driver boundary and assert the generated query +
// params (matches the unit convention in queries.test.ts). bridges is mocked so its NAMS/driver imports
// don't load (rankParks itself takes constraints as params; only the API route reads getTravelConstraints).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./bridges', () => ({ getTravelConstraints: vi.fn() }));

import { rankParks, resolveRankParams, clampNum, forYouFromNode } from './recommend';
import { readGraph } from './neo4j';
import { getTravelConstraints } from './bridges';

const mockRead = vi.mocked(readGraph);
const mockCons = vi.mocked(getTravelConstraints);

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

  it('honors the FULL /explore facet set so the live panel matches the faceted search', async () => {
    await rankParks({
      stateCode: 'MT',
      activity: 'Astronomy',
      topic: 'Geology',
      amenity: 'Accessible Restrooms',
      designation: 'National Park',
      darkSky: true,
    });
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain('(p)-[:LOCATED_IN]->(:State {code:$stateCode})');
    expect(q).toContain('(p)-[:OFFERS]->(:Activity {name:$activity})');
    expect(q).toContain('(p)-[:HAS_TOPIC]->(:Topic {name:$topic})');
    expect(q).toContain(':Amenity {name:$amenity}');
    expect(q).toContain('p.designation = $designation');
    expect(q).toContain('p.darkSkyCertified = true');
    expect(params).toMatchObject({
      stateCode: 'MT',
      activity: 'Astronomy',
      topic: 'Geology',
      amenity: 'Accessible Restrooms',
      designation: 'National Park',
    });
  });

  it('draws candidates from the SAME fulltext index as searchParks when q is present', async () => {
    await rankParks({ q: 'glacier', stateCode: 'MT' });
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain("db.index.fulltext.queryNodes('park_fulltext', $q)");
    expect(q).toContain('(p)-[:LOCATED_IN]->(:State {code:$stateCode})'); // facet still applied after YIELD
    expect(params).toMatchObject({ q: 'glacier', stateCode: 'MT' });
  });

  it('uses a plain MATCH (no fulltext) when q is absent', async () => {
    await rankParks({ stateCode: 'MT' });
    const [q] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain('MATCH (p:Park)');
    expect(q).not.toContain('db.index.fulltext.queryNodes');
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

  it('passes the full facet set through so the live panel refines within the faceted search', () => {
    const p = resolveRankParams(
      { q: 'lakes', stateCode: 'MT', activity: 'Astronomy', topic: 'Geology', amenity: 'Accessible Restrooms', designation: 'National Park', darkSky: true },
      cons,
      'u1',
    );
    expect(p).toMatchObject({
      q: 'lakes',
      stateCode: 'MT',
      activity: 'Astronomy',
      topic: 'Geology',
      amenity: 'Accessible Restrooms',
      designation: 'National Park',
      darkSky: true,
    });
  });

  it('treats an empty q as absent (no fulltext branch) and darkSky defaults to false', () => {
    const p = resolveRankParams({ q: '' }, cons, null);
    expect(p.q).toBeUndefined();
    expect(p.darkSky).toBe(false);
  });
});

describe('forYouFromNode (#9 — recommend from a seed park)', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockCons.mockReset();
    mockCons.mockResolvedValue({ wheelchair: true, rvMaxLengthFt: 22, requiredAmenities: ['Restrooms'] });
  });

  it('binds seed + travel constraints and emits the 2-hop, novelty-filtered query', async () => {
    mockRead.mockResolvedValue([] as never);
    await forYouFromNode('u1', 'yell', { limit: 5 });
    const [cypher, params] = mockRead.mock.calls[0];
    // 2-hop: seed → shared dimension ← other park.
    expect(cypher).toMatch(/-\[:OFFERS\|HAS_TOPIC\]->\(d\)<-\[r2:OFFERS\|HAS_TOPIC\]-\(p:Park\)/);
    // Novelty: exclude already-considered + planned parks.
    expect(cypher).toMatch(/NOT \(u\)-\[:CONSIDERED\]->\(p\)/);
    expect(cypher).toMatch(/NOT EXISTS \{ \(u\)-\[:PLANNED\]/);
    // Loved prefs weighted over generic shares — and a MUTED pref (weight 0) does NOT count as loved.
    expect(cypher).toMatch(/EXISTS \{ \(u\)-\[pw:PREFERS\]->\(d\) WHERE coalesce\(pw\.weight, 1\.0\) > 0 \} AS loved/);
    expect(params).toMatchObject({ userId: 'u1', parkCode: 'yell', limit: 5, rv: 22, wheelchair: true, required: ['Restrooms'] });
  });

  it('maps matched from loved prefs, falling back to the first shared dimensions', async () => {
    mockRead.mockResolvedValue([
      {
        seedName: 'Yellowstone', parkCode: 'grte', name: 'Grand Teton', designation: 'National Park', states: 'WY',
        lat: 43.7, lng: -110.7, image: null, matches: 2, score: 4,
        lovedNames: ['Geology'],
        shared: [
          { name: 'Geology', kind: 'topic', via: 'HAS_TOPIC' },
          { name: 'Hiking', kind: 'activity', via: 'OFFERS' },
        ],
      },
      {
        seedName: 'Yellowstone', parkCode: 'glac', name: 'Glacier', designation: 'National Park', states: 'MT',
        lat: 48.7, lng: -113.7, image: null, matches: 3, score: 3,
        lovedNames: [],
        shared: [
          { name: 'Wildlife', kind: 'topic', via: 'HAS_TOPIC' },
          { name: 'Camping', kind: 'activity', via: 'OFFERS' },
          { name: 'Fishing', kind: 'activity', via: 'OFFERS' },
        ],
      },
    ] as never);
    const { seedName, parks } = await forYouFromNode('u1', 'yell');
    expect(seedName).toBe('Yellowstone');
    // Loved prefs win when present...
    expect(parks[0]).toMatchObject({ parkCode: 'grte', matched: ['Geology'] });
    expect(parks[0].sharedVia).toHaveLength(2);
    // ...else the first two shared dimensions become the reason.
    expect(parks[1].matched).toEqual(['Wildlife', 'Camping']);
    expect(parks[1].sharedVia).toHaveLength(3);
  });
});
