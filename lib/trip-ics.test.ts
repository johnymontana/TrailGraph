import { describe, it, expect } from 'vitest';
import { tripToIcs } from './trip-ics';

const STAMP = '20260101T000000Z';

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Big Sky Loop',
    startDate: '2026-07-01',
    endDate: null,
    stops: [
      { id: 's1', day: 1, parkName: 'Yellowstone National Park' },
      { id: 's2', day: 2, parkName: 'Glacier National Park' },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...overrides,
  } as any;
}

describe('tripToIcs', () => {
  it('emits a VCALENDAR with one all-day VEVENT per stop, day-offset from startDate', () => {
    const ics = tripToIcs(trip(), { baseDate: '20260601', stamp: STAMP });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    // day 1 → startDate, day 2 → startDate + 1
    expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260702');
    expect(ics).toContain('Yellowstone National Park');
  });

  it('falls back to opts.baseDate when the trip has no startDate', () => {
    const ics = tripToIcs(trip({ startDate: null }), { baseDate: '20260601', stamp: STAMP });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260601');
  });

  it('handles month boundaries when adding days', () => {
    const ics = tripToIcs(
      trip({ startDate: '2026-07-31', stops: [{ id: 's1', day: 2, parkName: 'P' }] }),
      { baseDate: '20260601', stamp: STAMP },
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20260801'); // 07-31 + 1 day
  });

  it('uses name → "Stop" fallback for an unnamed stop and ignores null stops', () => {
    const ics = tripToIcs(
      trip({ stops: [null, { id: 's9', day: 1 }] }),
      { baseDate: '20260601', stamp: STAMP },
    );
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain('SUMMARY:Stop');
  });
});
