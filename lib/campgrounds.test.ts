import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// campgrounds.ts imports the Neo4j driver boundary at module load; mock it so this pure-logic unit test
// asserts the generated Cypher + params shape without touching a real DB (matches lib/queries.test.ts).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
// Mock only the live fetch from the availability adapter; keep its pure helpers real (importActual).
vi.mock('./datasources/campAvailability', async (orig) => ({
  ...(await orig<typeof import('./datasources/campAvailability')>()),
  getCampgroundAvailability: vi.fn(),
}));

import {
  searchCampgrounds,
  bookingWindowOpenDate,
  bookingUrlFor,
  campgroundDetail,
  campgroundFacets,
  searchAvailability,
  campAvailabilityForList,
} from './campgrounds';
import { readGraph } from './neo4j';
import { getCampgroundAvailability } from './datasources/campAvailability';

const mockAvail = vi.mocked(getCampgroundAvailability);

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

describe('campgroundDetail — shapes the result', () => {
  it('parses sourceIds, normalizes maxAmps 0→null, returns nested arrays', async () => {
    mockRead.mockReset();
    mockRead.mockResolvedValueOnce([
      {
        id: 'cg-x', name: 'X', source: 'nps+ridb', maxAmps: 0, sourceIdsRaw: '{"ridbId":"232449"}',
        agencyName: 'National Park Service', agencyKind: 'NPS',
        sites: [{ id: 's1', type: 'tent' }], amenities: [{ id: 'amen:shower', name: 'Shower' }],
        nearParks: [{ parkCode: 'yell', name: 'Yellowstone', miles: 9 }], nearTrails: [],
      } as never,
    ]);
    const d = await campgroundDetail('cg-x');
    expect(d?.sourceIds).toEqual({ ridbId: '232449' });
    expect(d?.maxAmps).toBeNull(); // 0 → null
    expect(d?.agencyKind).toBe('NPS');
    expect(d?.sites).toHaveLength(1);
    expect(d?.nearParks[0].parkCode).toBe('yell');
  });
  it('returns null when not found, tolerates bad sourceIds JSON', async () => {
    mockRead.mockReset();
    mockRead.mockResolvedValueOnce([]);
    expect(await campgroundDetail('nope')).toBeNull();
    mockRead.mockReset();
    mockRead.mockResolvedValueOnce([{ id: 'y', name: 'Y', sourceIdsRaw: 'not json', sites: [], amenities: [], nearParks: [], nearTrails: [] } as never]);
    expect((await campgroundDetail('y'))?.sourceIds).toBeNull();
  });
});

describe('campgroundFacets — filters + sorts', () => {
  it('drops null agencies/siteTypes, sorts parks/recAreas by name', async () => {
    mockRead.mockReset();
    mockRead.mockResolvedValueOnce([
      {
        agencies: ['USFS', null, 'NPS'], siteTypes: ['rv', null, 'tent'],
        parks: [{ parkCode: 'b', name: 'Bryce' }, { parkCode: 'a', name: 'Acadia' }, null],
        recAreas: [{ id: 'r1', name: 'Zed NF' }, { id: 'r2', name: 'Alpha NF' }],
        maxFee: 40, maxRv: 40,
      } as never,
    ]);
    const f = await campgroundFacets();
    expect(f.agencies).toEqual(['NPS', 'USFS']); // null dropped, sorted
    expect(f.siteTypes).toEqual(['rv', 'tent']);
    expect(f.parks.map((p) => p.name)).toEqual(['Acadia', 'Bryce']);
    expect(f.recAreas[0].name).toBe('Alpha NF');
    expect(f.maxFeeUSD).toBe(40);
  });
});

describe('campAvailabilityForList', () => {
  beforeEach(() => mockAvail.mockReset());

  it('returns no entries when no dates / empty input', async () => {
    expect(await campAvailabilityForList([{ id: 'a', ridbId: '1', totalSites: 10 }], { from: 'bad', to: 'bad' })).toEqual({});
  });
  it('marks state unavailable when every month poll returns null (flag off / unreachable)', async () => {
    mockAvail.mockResolvedValue(null);
    const out = await campAvailabilityForList([{ id: 'a', ridbId: '1', totalSites: 10 }], { from: '2030-07-03', to: '2030-07-04' });
    expect(out.a).toEqual({ sitesOpen: null, total: 10, state: 'unavailable' });
  });
  it('reports distinct open sites for the window when data is present', async () => {
    mockAvail.mockResolvedValue({
      ridbId: '1', monthStart: '2030-07-01', fetchedAt: 'x', siteType: { s1: 'tent', s2: 'rv' },
      days: [{ date: '2030-07-03', sitesOpen: 2, byType: { tent: 1, rv: 1 } }],
      perSite: { s1: { '2030-07-03': 'open' }, s2: { '2030-07-03': 'open' } },
    });
    const out = await campAvailabilityForList([{ id: 'a', ridbId: '1', totalSites: 50 }], { from: '2030-07-03', to: '2030-07-03' });
    expect(out.a).toEqual({ sitesOpen: 2, total: 50, state: 'ok' });
  });
  it('skips items without a ridbId', async () => {
    const out = await campAvailabilityForList([{ id: 'a', ridbId: null, totalSites: 10 }], { from: '2030-07-03', to: '2030-07-04' });
    expect(out.a).toBeUndefined();
    expect(mockAvail).not.toHaveBeenCalled();
  });
});

describe('searchAvailability', () => {
  beforeEach(() => mockAvail.mockReset());
  afterEach(() => delete process.env.CAMP_AVAILABILITY_ENABLED); // never leak the flag to other tests

  it('degrades to deep-link results when the flag is OFF (never polls)', async () => {
    delete process.env.CAMP_AVAILABILITY_ENABLED;
    mockRead.mockReset();
    // searchCampgrounds (items, count) for the candidate set:
    mockRead
      .mockResolvedValueOnce([{ id: 'cg-x', name: 'X', ridbId: '232449', reservationUrl: null } as never])
      .mockResolvedValueOnce([{ total: 1 }]);
    const r = await searchAvailability({ parkCode: 'yose', startDate: '2030-07-03', endDate: '2030-07-04' });
    expect(r.degraded).toBe(true);
    expect(r.results[0].bookingUrl).toContain('recreation.gov');
    expect(mockAvail).not.toHaveBeenCalled();
  });

  it('polls + ranks open campgrounds by nights-open when the flag is ON', async () => {
    process.env.CAMP_AVAILABILITY_ENABLED = '1';
    mockRead.mockReset();
    mockRead
      .mockResolvedValueOnce([{ id: 'cg-x', name: 'X', ridbId: '232449', reservationUrl: null, distanceMiles: 5 } as never])
      .mockResolvedValueOnce([{ total: 1 }]);
    mockAvail.mockResolvedValue({
      ridbId: '232449', monthStart: '2030-07-01', fetchedAt: 'x', siteType: { s1: 'tent' },
      days: [{ date: '2030-07-03', sitesOpen: 1, byType: { tent: 1 } }, { date: '2030-07-04', sitesOpen: 1, byType: { tent: 1 } }],
      perSite: { s1: { '2030-07-03': 'open', '2030-07-04': 'open' } },
    });
    const r = await searchAvailability({ parkCode: 'yose', startDate: '2030-07-03', endDate: '2030-07-04' });
    expect(r.degraded).toBe(false);
    expect(r.results[0].nightsOpen).toBe(2);
  });
});

