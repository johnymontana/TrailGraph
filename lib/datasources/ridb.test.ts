import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.RIDB_API_KEY = 'test-ridb-key';
});

import {
  mapAgencyKind,
  mapCampsiteType,
  campsiteAttrs,
  facilityAttrs,
  fetchFacilitiesPage,
  fetchFacilityCampsites,
  RidbRateLimitError,
  type RidbAttribute,
} from './ridb';

const ridbOk = (recdata: unknown[], total = recdata.length) => ({
  ok: true,
  status: 200,
  json: async () => ({ RECDATA: recdata, METADATA: { RESULTS: { CURRENT_COUNT: recdata.length, TOTAL_COUNT: total } } }),
});

describe('mapAgencyKind', () => {
  it('maps known managing orgs', () => {
    expect(mapAgencyKind('National Park Service')).toBe('NPS');
    expect(mapAgencyKind('USDA Forest Service')).toBe('USFS');
    expect(mapAgencyKind('Bureau of Land Management')).toBe('BLM');
    expect(mapAgencyKind('US Army Corps of Engineers')).toBe('USACE');
    expect(mapAgencyKind('California State Parks')).toBe('STATE');
  });
  it('defaults unknown/other federal orgs to PRIVATE (name preserved separately)', () => {
    expect(mapAgencyKind('Bureau of Reclamation')).toBe('PRIVATE');
    expect(mapAgencyKind(undefined)).toBe('PRIVATE');
    expect(mapAgencyKind(null)).toBe('PRIVATE');
  });
});

describe('mapCampsiteType', () => {
  it('buckets by most-specific keyword first', () => {
    expect(mapCampsiteType('GROUP TENT ONLY AREA NONELECTRIC')).toBe('group');
    expect(mapCampsiteType('EQUESTRIAN NONELECTRIC')).toBe('equestrian');
    expect(mapCampsiteType('CABIN NONELECTRIC')).toBe('cabin');
    expect(mapCampsiteType('WALK TO')).toBe('walk-in');
    expect(mapCampsiteType('TENT ONLY NONELECTRIC')).toBe('tent');
    expect(mapCampsiteType('RV NONELECTRIC')).toBe('rv');
  });
  it('defaults STANDARD / unknown to rv (accommodates an RV)', () => {
    expect(mapCampsiteType('STANDARD ELECTRIC')).toBe('rv');
    expect(mapCampsiteType('')).toBe('rv');
    expect(mapCampsiteType(undefined)).toBe('rv');
  });
});

describe('campsiteAttrs', () => {
  const attrs = (pairs: [string, string][]): RidbAttribute[] =>
    pairs.map(([AttributeName, AttributeValue]) => ({ AttributeName, AttributeValue }));

  it('parses length, amps, water/sewer, pull-through, occupancy, campfire, shade', () => {
    const a = campsiteAttrs(
      attrs([
        ['Max Vehicle Length', '40'],
        ['Electricity Hookup', '30/50 amp'],
        ['Water Hookup', 'Yes'],
        ['Sewer Hookup', 'No'],
        ['Driveway Type', 'Pull-Through'],
        ['Max Num of People', '8'],
        ['Campfire Allowed', 'Yes'],
        ['Shade', 'Yes'],
      ]),
    );
    expect(a).toEqual({
      maxRvLengthFt: 40,
      electricAmps: 50, // max of 30/50
      hasWater: true,
      hasSewer: false,
      pullThrough: true,
      maxPeople: 8,
      campfireAllowed: true,
      shade: true,
    });
  });

  it('distinguishes an explicit "Campfire Allowed: No" from an unreported campfire attr', () => {
    expect(campsiteAttrs(attrs([['Campfire Allowed', 'No']])).campfireAllowed).toBe(false);
    expect(campsiteAttrs(attrs([])).campfireAllowed).toBeNull();
  });

  it('detects pull-through from the full-export "Driveway Entry" key (not just API "Driveway Type")', () => {
    expect(campsiteAttrs(attrs([['Driveway Entry', 'Pull-Through']])).pullThrough).toBe(true);
    expect(campsiteAttrs(attrs([['Driveway Entry', 'Back-In']])).pullThrough).toBe(false);
    expect(campsiteAttrs(attrs([['Driveway Entry', 'Parallel']])).pullThrough).toBe(false);
  });
  it('treats a bare "Yes" electric hookup as 30 amp, absent as null', () => {
    expect(campsiteAttrs(attrs([['Electricity Hookup', 'Yes']])).electricAmps).toBe(30);
    expect(campsiteAttrs(attrs([['Electricity Hookup', 'No']])).electricAmps).toBeNull();
    expect(campsiteAttrs([]).electricAmps).toBeNull();
  });
  it('returns all-empty for no attributes', () => {
    expect(campsiteAttrs(null)).toEqual({
      maxRvLengthFt: null,
      electricAmps: null,
      hasWater: false,
      hasSewer: false,
      pullThrough: false,
      maxPeople: null,
      campfireAllowed: null,
      shade: false,
    });
  });
});

describe('facilityAttrs', () => {
  it('parses pets / fee / cell when present, null when absent', () => {
    const f = facilityAttrs([
      { AttributeName: 'Pets Allowed', AttributeValue: 'Yes' },
      { AttributeName: 'Base Fee', AttributeValue: '$25 per night' },
      { AttributeName: 'Cell Phone Reception', AttributeValue: 'No' },
    ]);
    expect(f).toEqual({ petsAllowed: true, feeUSD: 25, cellReception: false });
  });
  it('returns null for unreported facility attributes', () => {
    expect(facilityAttrs([])).toEqual({ petsAllowed: null, feeUSD: null, cellReception: null });
  });
});

describe('fetchFacilitiesPage (RIDB client)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends the apikey header + camping activity, returns {data,total} from the envelope', async () => {
    const fetchMock = vi.fn(async () => ridbOk([{ FacilityID: '1', FacilityName: 'A' }], 250));
    vi.stubGlobal('fetch', fetchMock);
    const page = await fetchFacilitiesPage(50, { lastUpdated: '06-01-2026' });
    expect(page.total).toBe(250);
    expect(page.data[0].FacilityID).toBe('1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/facilities?');
    expect(url).toContain('offset=50');
    expect(url).toContain('activity=9'); // Camping
    expect(url).toContain('lastupdated=06-01-2026');
    expect((init.headers as Record<string, string>).apikey).toBe('test-ridb-key');
  });

  it('throws a plain Error (not a pause) on a 4xx that is not 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad request' })));
    await expect(fetchFacilitiesPage(0)).rejects.toThrow(/RIDB facilities 400/);
  });

  it('PAUSES (RidbRateLimitError) after retries are exhausted on a persistent 429', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })));
    const p = fetchFacilitiesPage(0);
    const assertion = expect(p).rejects.toBeInstanceOf(RidbRateLimitError);
    await vi.advanceTimersByTimeAsync(60_000); // run through the 5 exponential backoffs
    await assertion;
  });

  it('retries a truncated/unparseable body, then succeeds', async () => {
    let n = 0;
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => (n++ === 0 ? { ok: true, status: 200, json: async () => { throw new Error('truncated'); } } : ridbOk([{ FacilityID: '9' }], 1))));
    const p = fetchFacilitiesPage(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await p).data[0].FacilityID).toBe('9');
  });
});

describe('fetchFacilityCampsites (paginates a facility)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('walks pages until the total is reached', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (call++ === 0 ? ridbOk(Array.from({ length: 50 }, (_, i) => ({ CampsiteID: String(i), FacilityID: 'f' })), 60) : ridbOk(Array.from({ length: 10 }, (_, i) => ({ CampsiteID: String(50 + i), FacilityID: 'f' })), 60))));
    const sites = await fetchFacilityCampsites('f');
    expect(sites).toHaveLength(60);
  });
});
