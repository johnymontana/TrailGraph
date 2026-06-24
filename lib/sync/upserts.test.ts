import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
import {
  normalizeCampgroundAccessibility,
  normalizeParkingAccessibility,
  extractAmenityChildIds,
  extractTrailMetrics,
  parseFeeUnit,
  yesNo,
  normSeasons,
  normStrings,
  extractCampsiteInventory,
  addDaysISO,
  expandEventDates,
  parseReleaseDate,
  extractParkingDetail,
  extractContacts,
  upsertOperatingHoursForOwners,
  upsertEntranceFees,
} from './upserts';
import { readGraph, writeGraph } from '../neo4j';

const mockRead = vi.mocked(readGraph);
const mockWrite = vi.mocked(writeGraph);

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
});

describe('normalizeCampgroundAccessibility (NPS accessibility blob → structured props)', () => {
  it('extracts wheelchair + RV max length from typical fields', () => {
    expect(
      normalizeCampgroundAccessibility({ wheelchairAccess: 'Accessible sites available', rvMaxLength: '40' }),
    ).toEqual({ wheelchairAccessible: true, rvMaxLengthFt: 40, adaInfo: null });
  });

  it('reads wheelchair from classifications array', () => {
    expect(normalizeCampgroundAccessibility({ classifications: ['Accessible', 'Reservable'] }).wheelchairAccessible).toBe(true);
  });

  it('treats "not accessible" as false and 0/blank RV length as null', () => {
    expect(normalizeCampgroundAccessibility({ wheelchairAccess: 'Not accessible', rvMaxLength: '0' })).toEqual({
      wheelchairAccessible: false,
      rvMaxLengthFt: null,
      adaInfo: null,
    });
  });

  it('handles an empty/undefined blob', () => {
    expect(normalizeCampgroundAccessibility(undefined)).toEqual({
      wheelchairAccessible: false,
      rvMaxLengthFt: null,
      adaInfo: null,
    });
  });

  it('passes through adaInfo text', () => {
    expect(normalizeCampgroundAccessibility({ adaInfo: 'Paved paths to restrooms' }).adaInfo).toBe(
      'Paved paths to restrooms',
    );
  });
});

describe('normalizeParkingAccessibility (parking lot accessibility → wheelchair flag)', () => {
  it('reads the explicit boolean flag', () => {
    expect(normalizeParkingAccessibility({ isLotAccessibleToDisabled: true }).wheelchairAccessible).toBe(true);
    expect(normalizeParkingAccessibility({ isLotAccessibleToDisabled: 'true' }).wheelchairAccessible).toBe(true);
  });

  it('falls back to free-text detection', () => {
    expect(normalizeParkingAccessibility({ adaInfo: 'ADA spaces near the entrance' }).wheelchairAccessible).toBe(true);
    expect(normalizeParkingAccessibility({ wheelchairAccess: 'Not accessible' }).wheelchairAccessible).toBe(false);
  });

  it('handles an empty/undefined blob', () => {
    expect(normalizeParkingAccessibility(undefined).wheelchairAccessible).toBe(false);
  });
});

describe('extractAmenityChildIds (NPS /amenities/parksplaces|parksvisitorcenters shape)', () => {
  it('unwraps the single-element array wrapper and reads parks[].places[].id', () => {
    // Real shape: data is a list of single-element arrays, each wrapping one amenity object.
    const items = [
      [
        {
          id: 'am1',
          name: 'ATM/Cash Machine',
          parks: [
            { parkCode: 'badl', places: [{ id: 'p1', title: 'Cedar Pass Lodge' }] },
            { parkCode: 'bibe', places: [{ id: 'p2' }, { id: 'p3' }] },
          ],
        },
      ],
    ];
    expect(extractAmenityChildIds(items, 'places')).toEqual([
      { amenityId: 'am1', amenityName: 'ATM/Cash Machine', childIds: ['p1', 'p2', 'p3'] },
    ]);
  });

  it('reads the lowercase visitorcenters child key', () => {
    const items = [[{ id: 'am2', name: 'Restroom', parks: [{ parkCode: 'yell', visitorcenters: [{ id: 'v1' }] }] }]];
    expect(extractAmenityChildIds(items, 'visitorcenters')[0].childIds).toEqual(['v1']);
  });

  it('falls back to any array-of-{id} on the park when the key differs', () => {
    const items = [[{ id: 'am3', name: 'X', parks: [{ parkCode: 'yell', visitorCenters: [{ id: 'v9' }] }] }]];
    expect(extractAmenityChildIds(items, 'visitorcenters')[0].childIds).toEqual(['v9']);
  });

  it('also accepts already-unwrapped objects and drops items without an id', () => {
    const items = [{ id: 'am4', name: 'Y', parks: [{ parkCode: 'yell', places: [{ id: 'p9' }] }] }, [{}]];
    const rows = extractAmenityChildIds(items, 'places');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ amenityId: 'am4', amenityName: 'Y', childIds: ['p9'] });
  });

  it('returns empty childIds when a park has no child array', () => {
    const items = [[{ id: 'am5', name: 'Z', parks: [{ parkCode: 'yell' }] }]];
    expect(extractAmenityChildIds(items, 'places')[0].childIds).toEqual([]);
  });

  it('ignores malformed parks payloads that are not arrays', () => {
    const items = [[{ id: 'am6', name: 'Q', parks: { parkCode: 'yell', places: [{ id: 'p1' }] } }]];
    expect(extractAmenityChildIds(items, 'places')[0].childIds).toEqual([]);
  });
});

describe('extractTrailMetrics (ThingToDo prose → length/elevation, latent-bug fix)', () => {
  it('extracts a decimal mileage and elevation when context is present', () => {
    expect(extractTrailMetrics('A 3.5-mile loop with 1,200 ft of elevation gain')).toEqual({
      lengthMiles: 3.5,
      elevationGainFt: 1200,
    });
  });

  it('reads "miles" plural and "mi" abbreviation', () => {
    expect(extractTrailMetrics('Hike 12 miles round trip').lengthMiles).toBe(12);
    expect(extractTrailMetrics('A quick 0.5 mi stroll').lengthMiles).toBe(0.5);
  });

  it('only takes elevation when an elevation-context word is present (avoids false positives)', () => {
    // "200 ft wide" has no elevation context → no elevation extracted.
    expect(extractTrailMetrics('A path 200 ft wide').elevationGainFt).toBeNull();
    expect(extractTrailMetrics('Climbs 850 feet to the summit').elevationGainFt).toBe(850);
  });

  it('does not mistake words like "minute"/"swim" for miles', () => {
    expect(extractTrailMetrics('A 20 minute walk to swim in the lake').lengthMiles).toBeNull();
  });

  it('rejects out-of-range values and empty text', () => {
    expect(extractTrailMetrics('')).toEqual({ lengthMiles: null, elevationGainFt: null });
    expect(extractTrailMetrics('a 250 mile epic').lengthMiles).toBeNull(); // > 100 mi cap
    expect(extractTrailMetrics('gain of 99,000 ft').elevationGainFt).toBeNull(); // > 30k ft cap
  });
});

describe('parseFeeUnit (entrance-fee title → billing unit, F2)', () => {
  it('maps NPS entrance-fee titles', () => {
    expect(parseFeeUnit('Entrance - Private Vehicle')).toBe('vehicle');
    expect(parseFeeUnit('Entrance - Motorcycle')).toBe('motorcycle');
    expect(parseFeeUnit('Entrance - Per Person')).toBe('person');
    expect(parseFeeUnit('Entrance - Individual (on foot or bicycle)')).toBe('person');
    expect(parseFeeUnit('Some Other Pass')).toBe('other');
  });
  it('prefers motorcycle over vehicle when both could match', () => {
    expect(parseFeeUnit('Motorcycle (per vehicle)')).toBe('motorcycle');
  });
});

describe('ThingToDo normalizers (F7)', () => {
  it('yesNo maps NPS strings/booleans', () => {
    expect(yesNo('Yes')).toBe(true);
    expect(yesNo('No')).toBe(false);
    expect(yesNo('Yes - leashed')).toBe(true);
    expect(yesNo(true)).toBe(true);
    expect(yesNo('maybe')).toBeNull();
    expect(yesNo(undefined)).toBeNull();
  });
  it('normSeasons maps to canonical domain seasons and de-dupes', () => {
    expect(normSeasons(['Spring', 'Fall', 'autumn'])).toEqual(['spring', 'fall']);
    expect(normSeasons(['Winter'])).toEqual(['winter']);
    expect(normSeasons('nope')).toEqual([]);
  });
  it('normStrings trims + de-dupes', () => {
    expect(normStrings([' Dawn ', 'Dusk', 'Dawn'])).toEqual(['Dawn', 'Dusk']);
    expect(normStrings(undefined)).toEqual([]);
  });
});

describe('extractCampsiteInventory (F3)', () => {
  it('parses counts + amenity presence from the NPS campground payload', () => {
    const inv = extractCampsiteInventory({
      id: 'cg1',
      name: 'Test',
      parkCode: 'yell',
      numberOfSitesReservable: '85',
      numberOfSitesFirstComeFirstServe: '0',
      campsites: { totalSites: '100', tentOnly: '20', rvOnly: '0', electricalHookups: '30', group: '2' },
      amenities: { dumpStation: 'Yes', showers: ['Yes - seasonal'], potableWater: ['None'], cellPhoneReception: 'No' },
    });
    expect(inv).toMatchObject({
      totalSites: 100,
      sitesReservable: 85,
      sitesFirstCome: 0,
      tentSites: 20,
      electricSites: 30,
      groupSites: 2,
      hasDumpStation: true,
      hasShowers: true,
      hasPotableWater: false, // ["None"] → absent
      hasHookups: true, // electricSites > 0
      cellReception: false,
    });
  });
  it('normalizes empty / missing fields to 0 / false', () => {
    const inv = extractCampsiteInventory({ id: 'cg2', name: 'X', parkCode: 'yell' });
    expect(inv).toMatchObject({ totalSites: 0, electricSites: 0, hasShowers: false, hasHookups: false });
  });
});

describe('event date expansion (F4)', () => {
  it('addDaysISO adds days across month/year boundaries (UTC)', () => {
    expect(addDaysISO('2026-06-24', 7)).toBe('2026-07-01');
    expect(addDaysISO('2026-12-30', 5)).toBe('2027-01-04');
  });
  it('uses concrete dates[] within the [today, today+horizon] window', () => {
    const today = '2026-06-24';
    const out = expandEventDates(
      { dates: ['2026-06-20', '2026-06-25', '2026-07-04', '2026-12-01'] },
      today,
      120,
    );
    expect(out).toEqual(['2026-06-25', '2026-07-04']); // drops the past date and the > 120-day one
  });
  it('falls back to datestart when dates[] is absent', () => {
    expect(expandEventDates({ datestart: '2026-07-01' }, '2026-06-24')).toEqual(['2026-07-01']);
    expect(expandEventDates({ datestart: '2020-01-01' }, '2026-06-24')).toEqual([]); // past → dropped
  });
});

describe('extractParkingDetail (F10)', () => {
  it('reads accessible spaces, EV charging (from text), and live-data presence', () => {
    expect(
      extractParkingDetail({
        id: 'lot1',
        name: 'Visitor Center Lot with EV Charging',
        accessibility: { totalSpaces: '6' },
        livedata: { occupancy: 0.5 },
      }),
    ).toEqual({ accessibleSpaces: 6, hasEvCharging: true, hasLiveData: true });
  });
  it('defaults to 0/false when absent', () => {
    expect(extractParkingDetail({ id: 'lot2', name: 'South Lot' })).toEqual({
      accessibleSpaces: 0,
      hasEvCharging: false,
      hasLiveData: false,
    });
  });
});

describe('parseReleaseDate (F8)', () => {
  it('extracts the ISO date from an NPS releasedate timestamp', () => {
    expect(parseReleaseDate('2026-06-20 00:00:00.0')).toBe('2026-06-20');
    expect(parseReleaseDate('2026-06-20')).toBe('2026-06-20');
    expect(parseReleaseDate('not a date')).toBeNull();
    expect(parseReleaseDate(undefined)).toBeNull();
  });
});

describe('extractContacts (bonus)', () => {
  it('pulls the primary phone + email from an NPS contacts blob', () => {
    expect(
      extractContacts({
        phoneNumbers: [{ phoneNumber: '406-888-7800', type: 'Voice' }],
        emailAddresses: [{ emailAddress: 'glac_info@nps.gov' }],
      }),
    ).toEqual({ phone: '406-888-7800', email: 'glac_info@nps.gov' });
  });
  it('returns nulls for an empty/missing blob', () => {
    expect(extractContacts(undefined)).toEqual({ phone: null, email: null });
    expect(extractContacts({})).toEqual({ phone: null, email: null });
  });
});

describe('operating hours upserts (F1/F3/F10)', () => {
  it('rebuilds owner hours even when the current payload has zero schedules', async () => {
    mockWrite.mockResolvedValueOnce([{ c: 1 }] as never);

    const count = await upsertOperatingHoursForOwners('Park', 'parkCode', [{ ownerKey: 'acad', schedules: [] }]);

    const [query, params] = mockWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain('OPTIONAL MATCH (o)-[:HAS_HOURS]->(oldH:OperatingHours)');
    expect(query).toContain('FOREACH (e IN oldEs | DETACH DELETE e)');
    expect(query).toContain('UNWIND row.schedules AS sch');
    expect(params).toEqual({ rows: [{ ownerKey: 'acad', schedules: [] }] });
    expect(count).toBe(1);
  });
});

describe('entrance fee upserts (F2)', () => {
  it('clears stale fees even when no current fee rows can be derived', async () => {
    mockRead.mockResolvedValueOnce([] as never);
    mockWrite.mockResolvedValueOnce([] as never);

    const count = await upsertEntranceFees();

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0]).toEqual(['MATCH (f:EntranceFee) DETACH DELETE f']);
    expect(count).toBe(0);
  });

  it('rebuilds all fee nodes after clearing the derived fee set', async () => {
    mockRead.mockResolvedValueOnce([
      {
        parkCode: 'yell',
        fees: JSON.stringify([{ title: 'Entrance - Private Vehicle', cost: '35', description: 'Per car' }]),
      },
    ] as never);
    mockWrite.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ c: 1 }] as never);

    const count = await upsertEntranceFees();

    expect(mockWrite).toHaveBeenCalledTimes(2);
    expect(mockWrite.mock.calls[0]).toEqual(['MATCH (f:EntranceFee) DETACH DELETE f']);
    const [query, params] = mockWrite.mock.calls[1] as [string, { rows: Array<Record<string, unknown>> }];
    expect(query).toContain('MERGE (f:EntranceFee {id: row.id})');
    expect(params.rows).toEqual([
      {
        id: 'yell:Entrance - Private Vehicle',
        parkCode: 'yell',
        title: 'Entrance - Private Vehicle',
        cost: 35,
        unit: 'vehicle',
        description: 'Per car',
      },
    ]);
    expect(count).toBe(1);
  });
});
