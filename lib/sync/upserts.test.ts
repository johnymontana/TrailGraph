import { describe, it, expect } from 'vitest';
import { normalizeCampgroundAccessibility, normalizeParkingAccessibility } from './upserts';

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
