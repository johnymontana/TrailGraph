import { describe, it, expect } from 'vitest';
import { normalizeCampgroundAccessibility, normalizeParkingAccessibility, extractAmenityChildIds } from './upserts';

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
});
