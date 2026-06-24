/**
 * Operating-hours parsing & open/closed logic (plan F1, Shared Primitive A) — reused by F3 (campground
 * hours) and F10 (parking hours). PURE & unit-tested: no I/O. The writer that turns these into
 * `(:OperatingHours)`/`(:HoursException)` nodes lives in `lib/sync/upserts.ts`.
 *
 * NPS `operatingHours[]` shape (already fetched for /parks; F1 adds it to /campgrounds + /visitorcenters):
 *   [{ name, description,
 *      standardHours: { monday:"All Day"|"Closed"|"8:00AM - 5:00PM", … sunday },
 *      exceptions: [{ name, startDate:"2026-10-15", endDate:"2027-05-20",
 *                     exceptionHours:{ monday:"Closed", … } }] }]
 *
 * neo4j-v6 rule: exception dates are stored as real `date()` (the writer converts) and ALWAYS returned
 * via `toString()`; all open/closed reasoning stays here in TS, never in Cypher.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** NPS day strings are full lowercase names; we store the compact 3-letter form on the node. */
const NPS_DAY_KEYS: Record<Weekday, string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

export type DayState = 'open' | 'closed' | 'unknown';

export interface HoursException {
  id: string;
  name: string;
  startDate: string | null; // ISO YYYY-MM-DD
  endDate: string | null;
  mon: string | null;
  tue: string | null;
  wed: string | null;
  thu: string | null;
  fri: string | null;
  sat: string | null;
  sun: string | null;
}

export interface HoursSchedule {
  id: string;
  name: string;
  allYear: boolean; // true when no dated exceptions narrow it
  mon: string | null;
  tue: string | null;
  wed: string | null;
  thu: string | null;
  fri: string | null;
  sat: string | null;
  sun: string | null;
  exceptions: HoursException[];
}

/** Classify a single NPS day string. Empty/missing → unknown (never falsely "closed"). Pure. */
export function dayState(s: string | null | undefined): DayState {
  if (s == null) return 'unknown';
  const t = String(s).trim().toLowerCase();
  if (t === '') return 'unknown';
  if (t === 'closed') return 'closed';
  if (t === 'all day' || /\d/.test(t)) return 'open'; // "All Day" or any time range like "8:00AM - 5:00PM"
  return 'unknown';
}

function dayMap(hours: Record<string, unknown> | undefined): Record<Weekday, string | null> {
  const out = {} as Record<Weekday, string | null>;
  for (const wd of WEEKDAYS) {
    const v = hours?.[NPS_DAY_KEYS[wd]];
    out[wd] = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  }
  return out;
}

const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
/** Normalize an NPS date string to ISO `YYYY-MM-DD`, or null if it isn't a clean date. Pure. */
export function parseNpsDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return isoDateRe.test(t) ? t : null;
}

/**
 * Parse the raw NPS `operatingHours[]` JSON for one owner into structured schedules. `ownerId` seeds the
 * synthetic node ids (NPS hours entries carry no id of their own). Pure.
 */
export function parseOperatingHours(raw: unknown, ownerId: string): HoursSchedule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map((h, i) => {
      const std = dayMap(h.standardHours as Record<string, unknown> | undefined);
      const id = `${ownerId}:hours:${i}`;
      const exsRaw = Array.isArray(h.exceptions) ? h.exceptions : [];
      const exceptions: HoursException[] = exsRaw
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e, j) => {
          const eh = dayMap(e.exceptionHours as Record<string, unknown> | undefined);
          return {
            id: `${id}:exc:${j}`,
            name: typeof e.name === 'string' ? e.name : '',
            startDate: parseNpsDate(e.startDate),
            endDate: parseNpsDate(e.endDate),
            ...eh,
          };
        });
      return {
        id,
        name: typeof h.name === 'string' && h.name.trim() ? h.name.trim() : 'Hours',
        allYear: exceptions.length === 0,
        ...std,
        exceptions,
      };
    });
}

/** Weekday (mon..sun) for an ISO date, using UTC to avoid TZ drift. Pure. Returns null if unparseable. */
export function weekdayOf(isoDate: string): Weekday | null {
  if (!isoDateRe.test(isoDate)) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // JS getUTCDay: 0=Sun..6=Sat → map to our mon-first array.
  return WEEKDAYS[(d.getUTCDay() + 6) % 7];
}

/** Is `isoDate` within an exception's [startDate,endDate] (inclusive)? Pure. */
export function dateInException(ex: HoursException, isoDate: string): boolean {
  if (!ex.startDate || !ex.endDate) return false;
  return isoDate >= ex.startDate && isoDate <= ex.endDate; // ISO strings compare lexicographically
}

/** Open/closed state of ONE schedule on a date — exception hours win over standard. Pure. */
export function scheduleStateOn(sch: HoursSchedule, isoDate: string): DayState {
  const wd = weekdayOf(isoDate);
  if (!wd) return 'unknown';
  const applicable = sch.exceptions.find((ex) => dateInException(ex, isoDate));
  if (applicable) return dayState(applicable[wd]);
  return dayState(sch[wd]);
}

/** Pick the park-level schedule ("Park Hours" by name, else the first). Pure. */
export function primarySchedule(schedules: HoursSchedule[]): HoursSchedule | null {
  if (!schedules.length) return null;
  return schedules.find((s) => /park hours/i.test(s.name)) ?? schedules[0];
}

/** Park open/closed on a date, from its primary schedule. Pure. */
export function openStateOn(schedules: HoursSchedule[], isoDate: string): DayState {
  const primary = primarySchedule(schedules);
  return primary ? scheduleStateOn(primary, isoDate) : 'unknown';
}

/**
 * A short human summary of dated closures across all schedules, e.g.
 * "Going-to-the-Sun Road: closed Oct 15 – May 20". Returns null when there are none. Pure.
 */
export function summarizeClosures(schedules: HoursSchedule[]): string | null {
  const fmt = (iso: string | null): string => {
    if (!iso) return '';
    const wd = weekdayOf(iso); // validates
    if (!wd) return '';
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const parts: string[] = [];
  for (const sch of schedules) {
    for (const ex of sch.exceptions) {
      // Only summarize exceptions that fully close (every named day "Closed").
      const days = WEEKDAYS.map((wd) => ex[wd]).filter((v) => v != null);
      const allClosed = days.length > 0 && days.every((v) => dayState(v) === 'closed');
      if (allClosed && ex.startDate && ex.endDate) {
        const label = /park hours/i.test(sch.name) ? '' : `${sch.name}: `;
        parts.push(`${label}closed ${fmt(ex.startDate)} – ${fmt(ex.endDate)}`);
      }
    }
  }
  return parts.length ? parts.join('; ') : null;
}

// ─── Domain seasons (Shared Primitive B; reused by F4/F7) ──────────────────────
export const SEASONS = ['winter', 'spring', 'summer', 'fall'] as const;
export type Season = (typeof SEASONS)[number];

/** Northern-hemisphere month (1-12) → season. Pure. */
export function monthToSeason(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}

/** Inclusive month numbers spanned by an ISO date range, handling year wrap (Oct→May). Pure. */
export function monthsInRange(startISO: string, endISO: string): number[] {
  const sm = Number(startISO.slice(5, 7));
  const em = Number(endISO.slice(5, 7));
  if (!sm || !em) return [];
  const out: number[] = [];
  let m = sm;
  for (let i = 0; i < 12; i++) {
    out.push(m);
    if (m === em) break;
    m = (m % 12) + 1;
  }
  return out;
}

/**
 * Which seasons the PARK (its primary schedule) is generally open. Heuristic, pure: start from the
 * standard week (open unless every day is "Closed"), add months opened by an opening exception, remove
 * months a full-closure exception covers, map surviving months → seasons. A road's closure does NOT
 * close the park because we read the park-hours schedule, not road schedules.
 */
export function deriveOpenSeasons(schedules: HoursSchedule[]): Season[] {
  const primary = primarySchedule(schedules);
  if (!primary) return [];
  const standardOpen = WEEKDAYS.some((wd) => dayState(primary[wd]) !== 'closed');
  const openMonths = new Set<number>(standardOpen ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : []);
  for (const ex of primary.exceptions) {
    if (!ex.startDate || !ex.endDate) continue;
    const named = WEEKDAYS.map((wd) => ex[wd]).filter((v) => v != null);
    if (!named.length) continue;
    const months = monthsInRange(ex.startDate, ex.endDate);
    if (named.every((v) => dayState(v) === 'closed')) {
      for (const m of months) openMonths.delete(m);
    } else if (named.some((v) => dayState(v) === 'open')) {
      for (const m of months) openMonths.add(m);
    }
  }
  const seasons = new Set<Season>();
  for (const m of openMonths) seasons.add(monthToSeason(m));
  return SEASONS.filter((s) => seasons.has(s));
}
