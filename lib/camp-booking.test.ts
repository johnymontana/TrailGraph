import { describe, it, expect } from 'vitest';
import { bookingSignal, BOOKING_BADGE_LABEL, BOOKING_PALETTE } from './camp-booking';

describe('bookingSignal', () => {
  it('mixed when both reservable and first-come sites exist (with the count split)', () => {
    const s = bookingSignal({ reservable: true, fcfs: true, sitesReservable: 42, sitesFirstCome: 18 });
    expect(s.kind).toBe('mixed');
    expect(s.label).toBe('Reservations + first-come');
    expect(s.detail).toBe('42 reservable · 18 first-come');
  });

  it('mixed from both flags alone omits the count detail (no honest split to show)', () => {
    const s = bookingSignal({ reservable: true, fcfs: true, sitesReservable: null, sitesFirstCome: null });
    expect(s.kind).toBe('mixed');
    expect(s.detail).toBeUndefined();
  });

  it('reservation when reservable and not fcfs', () => {
    const s = bookingSignal({ reservable: true, fcfs: false, sitesReservable: 42, sitesFirstCome: 0 });
    expect(s.kind).toBe('reservation');
    expect(s.label).toBe('Reservation required');
    expect(s.detail).toBe('42 reservable sites');
  });

  it('fcfs when first-come and not reservable', () => {
    const s = bookingSignal({ reservable: false, fcfs: true, sitesReservable: 0, sitesFirstCome: 1 });
    expect(s.kind).toBe('fcfs');
    expect(s.label).toBe('First-come, first-served');
    expect(s.detail).toBe('1 first-come site'); // singular
  });

  it('infers the mode from counts alone when the flags are absent', () => {
    expect(bookingSignal({ sitesReservable: 10 }).kind).toBe('reservation');
    expect(bookingSignal({ sitesFirstCome: 6 }).kind).toBe('fcfs');
    expect(bookingSignal({ sitesReservable: 10, sitesFirstCome: 6 }).kind).toBe('mixed');
  });

  it('a zero count is NOT a signal (0 reservable ≠ reservable)', () => {
    expect(bookingSignal({ sitesReservable: 0, sitesFirstCome: 0 }).kind).toBe('unknown');
    expect(bookingSignal({ fcfs: true, sitesReservable: 0 }).kind).toBe('fcfs');
  });

  it('unknown when there is no signal at all (nulls/undefined)', () => {
    expect(bookingSignal({})).toEqual({ kind: 'unknown', label: 'Booking info unavailable' });
    expect(bookingSignal({ reservable: null, fcfs: null, sitesReservable: null, sitesFirstCome: null }).kind).toBe(
      'unknown',
    );
    expect(bookingSignal({ reservable: false, fcfs: false }).kind).toBe('unknown');
  });

  it('every kind has a badge label and a colorPalette', () => {
    for (const kind of ['reservation', 'fcfs', 'mixed', 'unknown'] as const) {
      expect(BOOKING_BADGE_LABEL[kind]).toBeTruthy();
      expect(BOOKING_PALETTE[kind]).toBeTruthy();
    }
  });
});
