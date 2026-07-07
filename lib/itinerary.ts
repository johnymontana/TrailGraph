/**
 * Day-by-day structuring (C4). Pure, deterministic pacing heuristic: greedily pack ordered stops into
 * days, capping each day's combined drive + visit time at a budget. Honors the trip-planning skill's
 * "driving hours/day + buffer" idea without needing the model. Returns a day number per stop.
 */
export interface PacingStop {
  id: string;
  driveMinutesToHere?: number | null; // drive from the previous stop (DRIVE_TO.minutes)
  visitMinutes?: number | null; // expected time at this stop
}

export interface DayAssignment {
  id: string;
  day: number;
}

export function suggestDays(
  stops: PacingStop[],
  opts: { maxMinutesPerDay?: number; defaultVisitMinutes?: number } = {},
): DayAssignment[] {
  const maxPerDay = opts.maxMinutesPerDay ?? 480; // ~8h of drive+visit
  const defaultVisit = opts.defaultVisitMinutes ?? 180; // 3h per stop

  const out: DayAssignment[] = [];
  let day = 1;
  let dayLoad = 0;

  stops.forEach((s, i) => {
    const drive = Math.max(0, s.driveMinutesToHere ?? 0);
    const visit = Math.max(0, s.visitMinutes ?? defaultVisit);
    const cost = drive + visit;

    // First stop always starts day 1. Otherwise, roll to the next day if this stop would blow the
    // budget — but never strand a single oversized stop in a loop (it just takes its own day).
    if (i > 0 && dayLoad > 0 && dayLoad + cost > maxPerDay) {
      day += 1;
      dayLoad = 0;
    }
    dayLoad += cost;
    out.push({ id: s.id, day });
  });

  return out;
}

/**
 * Whether two stop-id lists contain the same ids, order-insensitive (stop ids are unique). The plan
 * provider uses this to decide whether a background `refreshTrip` may keep the client-only day plan
 * (ADR-076): same ids → the suggested days still map onto the stops; any add/remove → reset.
 */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export interface DayLoadStop {
  day: number | null;
  driveMinutesToHere?: number | null;
  hikeMiles?: number | null;
  hikeHours?: number | null; // sum of the stop's hikes' estTimeHrs
}

export interface DayLoad {
  day: number;
  hikeMiles: number;
  hikeHours: number;
  driveHours: number;
  overPacked: boolean;
}

/**
 * Per-day hiking + drive load for the schedule-aware "over-packed day" warning (ADR-071). Pure,
 * deterministic. A day is over-packed when its hiking hours + drive hours exceed `maxHours` (default 8) —
 * e.g. "Day 3: 14 mi hiking + a 3-hr drive — split it?".
 */
export function tripDayLoads(stops: DayLoadStop[], maxHours = 8): DayLoad[] {
  const byDay = new Map<number, { hikeMiles: number; hikeHours: number; driveMin: number }>();
  for (const s of stops) {
    const day = s.day ?? 0;
    if (!day) continue;
    const e = byDay.get(day) ?? { hikeMiles: 0, hikeHours: 0, driveMin: 0 };
    e.hikeMiles += Math.max(0, s.hikeMiles ?? 0);
    e.hikeHours += Math.max(0, s.hikeHours ?? 0);
    e.driveMin += Math.max(0, s.driveMinutesToHere ?? 0);
    byDay.set(day, e);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, e]) => {
      const driveHours = e.driveMin / 60;
      return {
        day,
        hikeMiles: Math.round(e.hikeMiles * 10) / 10,
        hikeHours: Math.round(e.hikeHours * 10) / 10,
        driveHours: Math.round(driveHours * 10) / 10,
        overPacked: e.hikeHours + driveHours > maxHours,
      };
    });
}

// ── Lodging suggestion (Campgrounds feature): pick where to sleep for a stop ──────────────────────────

export interface LodgingCandidate {
  id: string;
  name: string;
  driveMinFromLastHike: number; // drive time from the day's last activity
  availOpen: number | null; // sites open for the dates (null = unknown, NOT rejected)
  bookingDifficulty: number | null; // 0–100 (null = unknown)
}

export interface LodgingSuggestion {
  pick: string | null; // candidate id, or null when none is acceptable
  pickName: string | null;
  reason: string;
  overDrive: boolean; // the chosen pick exceeds the drive cap
  bookedOut: boolean; // every candidate is known-booked-out
  alternatives: string[]; // other candidate ids, ranked
}

/**
 * Suggest where to sleep for a stop: rank candidates by drive time from the day's last hike, treating a
 * known-booked-out candidate (`availOpen === 0`) as an alternative and a high booking-difficulty as a tie-
 * breaker. **`availOpen === null` is "unknown, allowed" — never auto-rejected** (availability is best-effort).
 * Pure + deterministic.
 */
export function suggestLodging(
  candidates: LodgingCandidate[],
  opts: { maxDriveMin?: number } = {},
): LodgingSuggestion {
  const maxDrive = opts.maxDriveMin ?? 90;
  if (!candidates.length) {
    return { pick: null, pickName: null, reason: 'No campgrounds found near this stop.', overDrive: false, bookedOut: false, alternatives: [] };
  }
  const bookable = candidates.filter((c) => c.availOpen == null || c.availOpen > 0); // unknown allowed
  const bookedOut = bookable.length === 0;
  const pool = bookedOut ? candidates : bookable;

  const rank = (c: LodgingCandidate) =>
    c.driveMinFromLastHike + (c.bookingDifficulty ?? 0) * 0.5 + (c.availOpen === 0 ? 1e6 : 0);
  const sorted = [...pool].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const pick = sorted[0];
  const overDrive = pick.driveMinFromLastHike > maxDrive;

  const reason = bookedOut
    ? `Everything nearby is booked for these dates — closest fallback is ${pick.name} (${pick.driveMinFromLastHike} min away). Try first-come arrival early, or set a Camp Watch.`
    : `${pick.name} — ${pick.driveMinFromLastHike} min from the day's last hike${
        pick.availOpen != null ? `, ${pick.availOpen} site${pick.availOpen === 1 ? '' : 's'} open` : ''
      }${overDrive ? ` (over your ${maxDrive}-min drive cap — consider a closer night)` : ''}.`;

  return {
    pick: pick.id,
    pickName: pick.name,
    reason,
    overDrive,
    bookedOut,
    alternatives: sorted.slice(1, 4).map((c) => c.id),
  };
}
