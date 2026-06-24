import { describe, it, expect, vi, beforeEach } from 'vitest';

// queries.ts imports the Neo4j driver boundary at module load; mock it so this pure-logic unit test
// never touches a real DB (matches lib/memory-graph.test.ts). vibeSearch embeds the query via the
// embed-cache, so mock that too — otherwise embedQuery would issue its own readGraph cache lookup and
// shift the vibeSearch query off mock.calls[0].
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('./embed-cache', () => ({ embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) }));

import { imagesWithFallback, vibeSearch, searchParks, facets, closureWarningsForTrip, parksWithEventOn } from './queries';
import { readGraph } from './neo4j';

const ALL_DAY = { monday: 'All Day', tuesday: 'All Day', wednesday: 'All Day', thursday: 'All Day', friday: 'All Day', saturday: 'All Day', sunday: 'All Day' };

describe('imagesWithFallback (park hero image source, ADR-039 #7)', () => {
  it('prefers the rich imagesFull records when present', () => {
    const full = [{ url: 'a.jpg', caption: 'A' }, { url: 'b.jpg' }];
    expect(imagesWithFallback(full, ['x.jpg'])).toEqual(full);
  });

  it('falls back to the plain p.images URL strings when imagesFull is empty', () => {
    expect(imagesWithFallback([], ['x.jpg', 'y.jpg'])).toEqual([{ url: 'x.jpg' }, { url: 'y.jpg' }]);
  });

  it('falls back when imagesFull is null/undefined', () => {
    expect(imagesWithFallback(null, ['x.jpg'])).toEqual([{ url: 'x.jpg' }]);
    expect(imagesWithFallback(undefined, ['x.jpg'])).toEqual([{ url: 'x.jpg' }]);
  });

  it('drops malformed entries in both sources', () => {
    expect(imagesWithFallback([{ caption: 'no url' }, { url: 'ok.jpg' }], [])).toEqual([{ url: 'ok.jpg' }]);
    expect(imagesWithFallback([], [null, 42, 'ok.jpg', { url: 'obj.jpg' }])).toEqual([
      { url: 'ok.jpg' },
      { url: 'obj.jpg' },
    ]);
  });

  it('returns an empty array when there is no image anywhere', () => {
    expect(imagesWithFallback([], [])).toEqual([]);
    expect(imagesWithFallback(null, null)).toEqual([]);
    expect(imagesWithFallback('garbage', undefined)).toEqual([]);
  });
});

describe('vibeSearch constraint-aware candidates (ADR-046, Friction #2)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue([] as never);
  });

  it('appends the travel-constraint WHERE clauses + params when constraints are passed', async () => {
    await vibeSearch('dark desert canyons', {
      limit: 6,
      rvMaxLengthFt: 30,
      wheelchairAccessible: true,
      requiredAmenities: ['Restrooms'],
      maxBortle: 2,
    });
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain('cg.rvMaxLengthFt >= $rv');
    expect(q).toContain('cg.wheelchairAccessible = true');
    expect(q).toContain('coalesce(p.bortleScale, 99) <= $maxBortle');
    expect(q).toContain('ALL(req IN $required');
    expect(params).toMatchObject({ rv: 30, wheelchair: true, required: ['Restrooms'], maxBortle: 2 });
    // over-fetch candidates when constraints will prune (treated as facets)
    expect(params.k).toBe(6 * 6);
  });

  it('stays backward-compatible: no constraints → null/false params, smaller candidate pool', async () => {
    await vibeSearch('alpine lakes', { limit: 10 });
    const [, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ rv: null, wheelchair: false, required: [], maxBortle: null });
    expect(params.k).toBe(10 * 2);
  });
});

describe('searchParks new discovery facets (plan P0-3)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue([] as never);
  });

  it('adds WHERE clauses + region param for the new F2/F3/F9/F10 facets', async () => {
    await searchParks({ feeFree: true, evParking: true, hookups: true, firstCome: true, groupSites: true, region: 'Rocky Mountains' });
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain('coalesce(p.feeFree, false) = true');
    expect(q).toContain('pl.hasEvCharging = true');
    expect(q).toContain('cg.hasHookups = true');
    expect(q).toContain('cg.sitesFirstCome > 0');
    expect(q).toContain('cg.groupSites > 0');
    expect(q).toContain('(p)-[:IN_REGION]->(:Region {name:$region})');
    expect(params).toMatchObject({ region: 'Rocky Mountains' });
  });

  it('omits the new clauses when facets are falsy (no-op)', async () => {
    await searchParks({});
    const [q] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).not.toContain('hasEvCharging');
    expect(q).not.toContain('IN_REGION');
    expect(q).not.toContain('hasHookups');
  });
});

describe('closureWarningsForTrip (plan P0-1)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => mockRead.mockReset());

  it('flags a park with a dated seasonal closure (park open, road closed)', async () => {
    mockRead.mockResolvedValue([
      { parkCode: 'glac', name: 'Glacier National Park', hours: JSON.stringify([{ name: 'Park Hours', standardHours: ALL_DAY, exceptions: [] }]), summary: 'Going-to-the-Sun Road: closed Oct 15 – May 20' },
    ] as never);
    const w = await closureWarningsForTrip(['glac'], '2026-12-15');
    expect(w).toHaveLength(1);
    expect(w[0].state).toBe('open'); // Park Hours are year-round; only the road closes
    expect(w[0].summary).toContain('Going-to-the-Sun Road');
  });

  it('reports a closed state when the park-hours schedule itself is closed on the date', async () => {
    mockRead.mockResolvedValue([
      { parkCode: 'grca', name: 'North Rim', hours: JSON.stringify([{ name: 'Park Hours', standardHours: ALL_DAY, exceptions: [{ name: 'Winter', startDate: '2026-12-01', endDate: '2027-02-28', exceptionHours: { monday: 'Closed', tuesday: 'Closed', wednesday: 'Closed', thursday: 'Closed', friday: 'Closed', saturday: 'Closed', sunday: 'Closed' } }] }]), summary: null },
    ] as never);
    const w = await closureWarningsForTrip(['grca'], '2026-12-15');
    expect(w[0].state).toBe('closed');
  });

  it('returns no warning for an open, closure-free park; and [] for empty input', async () => {
    mockRead.mockResolvedValue([{ parkCode: 'yose', name: 'Yosemite', hours: JSON.stringify([{ name: 'Park Hours', standardHours: ALL_DAY, exceptions: [] }]), summary: null }] as never);
    expect(await closureWarningsForTrip(['yose'], '2026-07-01')).toEqual([]);
    expect(await closureWarningsForTrip([], '2026-07-01')).toEqual([]);
  });
});

describe('parksWithEventOn (plan P1-5 — parameterized, no structure interpolation)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue([] as never);
  });
  it('passes eventType as a parameter (null or provided), with a fixed query shape', async () => {
    await parksWithEventOn('2026-08-12', 'Astronomy');
    const [q, params] = mockRead.mock.calls[0] as [string, Record<string, unknown>];
    expect(q).toContain('$eventType IS NULL OR EXISTS');
    expect(params).toMatchObject({ eventType: 'Astronomy', isoDate: '2026-08-12' });

    await parksWithEventOn('2026-08-12');
    const [, params2] = mockRead.mock.calls[1] as [string, Record<string, unknown>];
    expect(params2.eventType).toBeNull();
  });
});

describe('facets (plan P0-4)', () => {
  const mockRead = vi.mocked(readGraph);
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue([
      { activities: [], topics: [], amenities: [], designations: [], states: [], regions: ['Rocky Mountains'] },
    ] as never);
  });

  it('queries regions and excludes synthetic amen:* ids from the amenity dropdown', async () => {
    const f = await facets();
    const [q] = mockRead.mock.calls[0] as [string];
    expect(q).toContain('MATCH (r:Region)');
    expect(q).toContain("NOT coalesce(am.id, '') STARTS WITH 'amen:'");
    expect(f.regions).toContain('Rocky Mountains');
  });
});
