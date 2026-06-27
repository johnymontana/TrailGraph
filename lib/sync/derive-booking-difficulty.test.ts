import { describe, it, expect } from 'vitest';
import { computeBookingStats, parseReservationCsv } from './derive-booking-difficulty';

describe('computeBookingStats', () => {
  it('computes median books-out lead time + weekend fill rate per facility', () => {
    const stats = computeBookingStats([
      // facility A: leads 10, 20, 30 (median 20); 2 of 3 start on Fri/Sat
      { facilityId: 'A', orderDate: '2026-06-01', startDate: '2026-06-11', nights: 2 }, // +10, Thu
      { facilityId: 'A', orderDate: '2026-06-01', startDate: '2026-06-12', nights: 2 }, // +11, Fri
      { facilityId: 'A', orderDate: '2026-06-01', startDate: '2026-06-13', nights: 2 }, // +12, Sat
      // facility B: single
      { facilityId: 'B', orderDate: '2026-06-01', startDate: '2026-06-05', nights: 1 }, // +4, Fri
    ]);
    const a = stats.find((s) => s.facilityId === 'A')!;
    expect(a.booksOutDays).toBe(11); // median of 10,11,12
    expect(a.weekendFillRate).toBe(0.67); // 2 weekend of 3
    expect(a.reservations).toBe(3);
    const b = stats.find((s) => s.facilityId === 'B')!;
    expect(b.weekendFillRate).toBe(1);
  });

  it('ignores negative leads + handles empty', () => {
    expect(computeBookingStats([])).toEqual([]);
    const s = computeBookingStats([{ facilityId: 'X', orderDate: '2026-06-10', startDate: '2026-06-01', nights: 1 }]);
    expect(s[0].booksOutDays).toBeNull(); // only a negative lead → no valid lead
  });
});

describe('parseReservationCsv', () => {
  it('maps header columns regardless of order/case', () => {
    const csv = 'StartDate,FacilityID,OrderDate,Nights\n2026-06-12,A,2026-06-01,2\n2026-06-13,A,2026-06-02,1';
    const rows = parseReservationCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ facilityId: 'A', orderDate: '2026-06-01', startDate: '2026-06-12', nights: 2 });
  });
  it('returns [] without required columns', () => {
    expect(parseReservationCsv('a,b,c\n1,2,3')).toEqual([]);
    expect(parseReservationCsv('')).toEqual([]);
  });
});
