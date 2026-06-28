import { describe, it, expect } from 'vitest';
import { suggestDays, suggestLodging, type LodgingCandidate } from './itinerary';

describe('suggestLodging (Campgrounds feature)', () => {
  const cands = (over: Partial<LodgingCandidate>[]): LodgingCandidate[] =>
    over.map((o, i) => ({ id: o.id ?? `c${i}`, name: o.name ?? `Camp ${i}`, driveMinFromLastHike: o.driveMinFromLastHike ?? 30, availOpen: o.availOpen ?? null, bookingDifficulty: o.bookingDifficulty ?? null }));

  it('picks the closest bookable candidate', () => {
    const r = suggestLodging(cands([
      { id: 'far', driveMinFromLastHike: 80, availOpen: 5 },
      { id: 'near', driveMinFromLastHike: 20, availOpen: 2 },
    ]));
    expect(r.pick).toBe('near');
    expect(r.bookedOut).toBe(false);
    expect(r.alternatives).toContain('far');
  });

  it('treats unknown availability as allowed (never auto-rejected)', () => {
    const r = suggestLodging(cands([{ id: 'unknown', driveMinFromLastHike: 15, availOpen: null }]));
    expect(r.pick).toBe('unknown');
    expect(r.bookedOut).toBe(false);
  });

  it('flags all-booked-out + still offers the closest as a fallback', () => {
    const r = suggestLodging(cands([
      { id: 'a', driveMinFromLastHike: 40, availOpen: 0 },
      { id: 'b', driveMinFromLastHike: 25, availOpen: 0 },
    ]));
    expect(r.bookedOut).toBe(true);
    expect(r.pick).toBe('b'); // closest fallback
    expect(r.reason).toMatch(/booked/i);
  });

  it('flags an over-drive pick', () => {
    const r = suggestLodging(cands([{ id: 'x', driveMinFromLastHike: 200, availOpen: 1 }]), { maxDriveMin: 90 });
    expect(r.overDrive).toBe(true);
  });

  it('handles no candidates', () => {
    const r = suggestLodging([]);
    expect(r.pick).toBeNull();
    expect(r.reason).toMatch(/No campgrounds/);
  });
});

describe('suggestDays', () => {
  it('keeps light stops on the same day', () => {
    const days = suggestDays(
      [
        { id: 'a', driveMinutesToHere: 0, visitMinutes: 120 },
        { id: 'b', driveMinutesToHere: 30, visitMinutes: 120 },
      ],
      { maxMinutesPerDay: 480 },
    );
    expect(days).toEqual([
      { id: 'a', day: 1 },
      { id: 'b', day: 1 },
    ]);
  });

  it('rolls to a new day when the budget is exceeded', () => {
    const days = suggestDays(
      [
        { id: 'a', driveMinutesToHere: 0, visitMinutes: 300 },
        { id: 'b', driveMinutesToHere: 240, visitMinutes: 180 }, // 420 + 300 > 480 → day 2
      ],
      { maxMinutesPerDay: 480 },
    );
    expect(days.find((d) => d.id === 'b')?.day).toBe(2);
  });

  it('uses the default visit time when none is given', () => {
    const days = suggestDays([{ id: 'a' }, { id: 'b' }], { maxMinutesPerDay: 300, defaultVisitMinutes: 180 });
    // 180 then +180 > 300 → b on day 2
    expect(days).toEqual([
      { id: 'a', day: 1 },
      { id: 'b', day: 2 },
    ]);
  });

  it('never strands an oversized single stop in a loop', () => {
    const days = suggestDays([{ id: 'big', visitMinutes: 1000 }], { maxMinutesPerDay: 480 });
    expect(days).toEqual([{ id: 'big', day: 1 }]);
  });
});
