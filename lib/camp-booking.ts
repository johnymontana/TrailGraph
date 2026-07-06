/**
 * Booking-clarity signal (Campgrounds feature): turn the raw :Campground reservability props
 * (`reservable`/`fcfs` flags + `sitesReservable`/`sitesFirstCome` counts) into ONE plain-English
 * "do I need a reservation or can I just show up?" answer — the top user-feedback ask. Pure +
 * unit-tested; shared by the finder card, the detail-page callout, and the ranger chat cards so
 * the wording never drifts. Counts alone infer the flags (a count > 0 implies that booking mode),
 * and absence of every signal is honestly "unknown" — never rendered as either mode.
 */

export type BookingKind = 'reservation' | 'fcfs' | 'mixed' | 'unknown';

export interface BookingSignal {
  kind: BookingKind;
  label: string;
  detail?: string;
}

/** Compact badge wording per kind (finder card + chat cards share it). */
export const BOOKING_BADGE_LABEL: Record<BookingKind, string> = {
  reservation: 'Reservation',
  fcfs: 'First-come',
  mixed: 'Res + FCFS',
  unknown: 'Booking unknown',
};

/** Chakra colorPalette per kind (reservation → trail, fcfs → pine, mixed → sand, unknown → muted). */
export const BOOKING_PALETTE: Record<BookingKind, string> = {
  reservation: 'trail',
  fcfs: 'pine',
  mixed: 'sand',
  unknown: 'gray',
};

const plural = (n: number) => (n === 1 ? '' : 's');

/** Classify a campground's booking mode. Counts > 0 imply the corresponding flag when it's absent. */
export function bookingSignal(input: {
  reservable?: boolean | null;
  fcfs?: boolean | null;
  sitesReservable?: number | null;
  sitesFirstCome?: number | null;
}): BookingSignal {
  const resCount = input.sitesReservable ?? null;
  const fcfsCount = input.sitesFirstCome ?? null;
  const hasRes = input.reservable === true || (resCount != null && resCount > 0);
  const hasFcfs = input.fcfs === true || (fcfsCount != null && fcfsCount > 0);

  if (hasRes && hasFcfs) {
    return {
      kind: 'mixed',
      label: 'Reservations + first-come',
      // Counts only when both are reported — a flags-only mixed signal has no honest split to show.
      detail:
        resCount != null && fcfsCount != null ? `${resCount} reservable · ${fcfsCount} first-come` : undefined,
    };
  }
  if (hasRes) {
    return {
      kind: 'reservation',
      label: 'Reservation required',
      detail: resCount != null && resCount > 0 ? `${resCount} reservable site${plural(resCount)}` : undefined,
    };
  }
  if (hasFcfs) {
    return {
      kind: 'fcfs',
      label: 'First-come, first-served',
      detail: fcfsCount != null && fcfsCount > 0 ? `${fcfsCount} first-come site${plural(fcfsCount)}` : undefined,
    };
  }
  return { kind: 'unknown', label: 'Booking info unavailable' };
}
