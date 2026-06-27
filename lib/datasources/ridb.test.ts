import { describe, it, expect } from 'vitest';
import {
  mapAgencyKind,
  mapCampsiteType,
  campsiteAttrs,
  facilityAttrs,
  type RidbAttribute,
} from './ridb';

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

  it('parses length, amps, water/sewer, pull-through', () => {
    const a = campsiteAttrs(
      attrs([
        ['Max Vehicle Length', '40'],
        ['Electricity Hookup', '30/50 amp'],
        ['Water Hookup', 'Yes'],
        ['Sewer Hookup', 'No'],
        ['Driveway Type', 'Pull-Through'],
      ]),
    );
    expect(a).toEqual({
      maxRvLengthFt: 40,
      electricAmps: 50, // max of 30/50
      hasWater: true,
      hasSewer: false,
      pullThrough: true,
    });
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
