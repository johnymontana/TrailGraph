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
