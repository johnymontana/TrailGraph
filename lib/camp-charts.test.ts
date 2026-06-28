import { describe, it, expect } from 'vitest';
import { campgroundScores, campgroundCompareData, COMPARE_AXES } from './camp-charts';

describe('campgroundScores', () => {
  it('scores hookups by amps, affordability inverted by fee', () => {
    const s = campgroundScores({ maxAmps: 50, feeUSD: 0, free: true, ada: true, cellReception: true, totalSites: 300, amenityCount: 4, darkSky: true });
    expect(s.Hookups).toBe(100);
    expect(s.Affordability).toBe(100); // free
    expect(s.Accessibility).toBe(100);
    expect(s.Size).toBe(100); // 300/3
    expect(s.Amenities).toBe(60); // 4*15
    expect(s['Dark sky']).toBe(100);
  });
  it('a pricey no-hookup tent site scores low on those axes', () => {
    const s = campgroundScores({ feeUSD: 40, hasHookups: false, ada: false, cellReception: false, totalSites: 30 });
    expect(s.Hookups).toBe(0);
    expect(s.Affordability).toBe(40); // 100 - 40*1.5 = 40
    expect(s.Accessibility).toBe(0);
  });
  it('booking-ease is NaN when difficulty is unknown (greyed, not 100)', () => {
    expect(Number.isNaN(campgroundScores({})['Booking ease'])).toBe(true);
    expect(campgroundScores({ booksOutDays: 0 })['Booking ease']).toBe(100);
    expect(campgroundScores({ booksOutDays: 180 })['Booking ease']).toBe(0);
  });
});

describe('campgroundCompareData', () => {
  it('pivots to one column per campground and skips NaN axes', () => {
    const rows = campgroundCompareData([
      { key: 'A', scores: campgroundScores({ free: true, booksOutDays: 90 }) },
      { key: 'B', scores: campgroundScores({ feeUSD: 30 }) }, // unknown booking difficulty
    ]);
    expect(rows).toHaveLength(COMPARE_AXES.length);
    const ease = rows.find((r) => r.axis === 'Booking ease')!;
    expect(ease.A).toBeDefined(); // A had difficulty
    expect(ease.B).toBeUndefined(); // B's NaN was skipped (greyed)
    const aff = rows.find((r) => r.axis === 'Affordability')!;
    expect(aff.A).toBe(100);
    expect(aff.B).toBe(55); // 100 - 30*1.5
  });
});
