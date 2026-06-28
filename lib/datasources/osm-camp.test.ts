import { describe, it, expect, vi, afterEach } from 'vitest';
import { osmCampToRecord, isDispersed, osmCampAmenities, osmFeeUSD, fetchCampgroundsOSM, type OsmCampElement } from './osm-camp';

describe('isDispersed', () => {
  it('flags basic/wild/backcountry as dispersed', () => {
    expect(isDispersed({ camp_site: 'basic' })).toBe(true);
    expect(isDispersed({ camp_site: 'wild' })).toBe(true);
    expect(isDispersed({ backcountry: 'yes' })).toBe(true);
    expect(isDispersed({ fee: 'no' })).toBe(true); // no fee + no reservation + no operator
  });
  it('a fee/operated site is not dispersed', () => {
    expect(isDispersed({ camp_site: 'serviced', fee: 'yes', operator: 'KOA' })).toBe(false);
  });
});

describe('osmCampAmenities', () => {
  it('maps overlapping tags to canonical amen ids', () => {
    expect(osmCampAmenities({ drinking_water: 'yes', shower: 'yes', power_supply: '50A', sanitary_dump_station: 'yes' })).toEqual(
      expect.arrayContaining(['amen:potable-water', 'amen:shower', 'amen:hookup-50amp', 'amen:dump-station']),
    );
    expect(osmCampAmenities({ power_supply: 'yes' })).toContain('amen:hookup-30amp');
    expect(osmCampAmenities({})).toEqual([]);
  });
});

describe('osmFeeUSD', () => {
  it('parses fee=no → 0, a charge amount, else null', () => {
    expect(osmFeeUSD({ fee: 'no' })).toBe(0);
    expect(osmFeeUSD({ charge: '$25 per night' })).toBe(25);
    expect(osmFeeUSD({})).toBeNull();
  });
});

describe('osmCampToRecord', () => {
  const node = (tags: Record<string, string>, id = 1): OsmCampElement => ({ type: 'node', id, lat: 45, lon: -111, tags });

  it('maps a named reservable campground', () => {
    const r = osmCampToRecord(node({ tourism: 'camp_site', name: 'Pine Flat', reservation: 'yes', charge: '20' }))!;
    expect(r.osmId).toBe('osm:node/1');
    expect(r.name).toBe('Pine Flat');
    expect(r.reservable).toBe(true);
    expect(r.fcfs).toBe(false);
    expect(r.feeUSD).toBe(20);
    expect(r.dispersed).toBe(false);
  });

  it('names an unnamed dispersed site + marks it first-come', () => {
    const r = osmCampToRecord(node({ tourism: 'camp_site', camp_site: 'wild' }))!;
    expect(r.name).toBe('Dispersed campsite');
    expect(r.dispersed).toBe(true);
    expect(r.fcfs).toBe(true);
  });

  it('resolves a way center coordinate; null without any coordinate', () => {
    expect(osmCampToRecord({ type: 'way', id: 9, center: { lat: 44, lon: -110 }, tags: { tourism: 'camp_site', name: 'X' } })!.lat).toBe(44);
    expect(osmCampToRecord({ type: 'node', id: 2, tags: { tourism: 'camp_site', name: 'NoCoord' } })).toBeNull();
  });
});

describe('fetchCampgroundsOSM (Overpass)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('queries camp_site/caravan_site/camp_pitch over the bbox and maps elements (skips coord-less)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', id: 1, lat: 45, lon: -111, tags: { tourism: 'camp_site', name: 'Pine Flat' } },
          { type: 'way', id: 2, center: { lat: 45.1, lon: -111.1 }, tags: { tourism: 'camp_site', camp_site: 'wild' } },
          { type: 'node', id: 3, tags: { tourism: 'camp_site', name: 'NoCoord' } }, // dropped (no coord)
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const recs = await fetchCampgroundsOSM({ south: 44, west: -112, north: 46, east: -110 });
    expect(recs.map((r) => r.osmId)).toEqual(['osm:node/1', 'osm:way/2']);
    expect(recs[1].dispersed).toBe(true);
    const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toContain('camp_site');
    expect(body).toContain('caravan_site');
    expect(body).toContain('camp_pitch');
  });

  it('degrades to [] on a network error or non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('overpass down'); }));
    expect(await fetchCampgroundsOSM({ south: 0, west: 0, north: 1, east: 1 })).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504 })));
    expect(await fetchCampgroundsOSM({ south: 0, west: 0, north: 1, east: 1 })).toEqual([]);
  });
});
