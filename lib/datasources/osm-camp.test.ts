import { describe, it, expect } from 'vitest';
import { osmCampToRecord, isDispersed, osmCampAmenities, osmFeeUSD, type OsmCampElement } from './osm-camp';

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
