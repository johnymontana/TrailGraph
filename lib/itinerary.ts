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
