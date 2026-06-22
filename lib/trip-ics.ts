import { generateICS, type IcsAllDayEvent } from './ics';
import type { getTrip } from './trips';

type Trip = NonNullable<Awaited<ReturnType<typeof getTrip>>>;

function toYYYYMMDD(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

function addDays(baseYYYYMMDD: string, n: number): string {
  const y = Number(baseYYYYMMDD.slice(0, 4));
  const mo = Number(baseYYYYMMDD.slice(4, 6));
  const d = Number(baseYYYYMMDD.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}

/** Build an ICS calendar for a trip (C6). `baseDate`/`stamp` (YYYYMMDD / ISO-basic) passed by caller. */
export function tripToIcs(trip: Trip, opts: { baseDate: string; stamp: string }): string {
  const baseDate = toYYYYMMDD(trip.startDate) ?? opts.baseDate;
  const stops = ((trip.stops ?? []).filter(Boolean) as {
    id: string;
    day?: number | null;
    parkName?: string;
    name?: string;
  }[]);
  const events: IcsAllDayEvent[] = stops.map((s, i) => ({
    uid: `${s.id}@trailgraph`,
    date: addDays(baseDate, (s.day ?? i + 1) - 1),
    summary: s.parkName ?? s.name ?? 'Stop',
    description: 'TrailGraph itinerary — verify hours/closures at nps.gov before you go.',
  }));
  return generateICS(trip.name ?? 'TrailGraph Trip', events, opts.stamp);
}
