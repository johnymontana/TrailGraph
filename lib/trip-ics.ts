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

/** Timezone-independent astro facts for a stop's date (moon % + dark hours), injected by the caller. */
export interface SunTimesFn {
  (lat: number, lng: number, dateIso: string): { moonIllumination: number; darkHours: number | null } | null;
}

/** YYYYMMDD → YYYY-MM-DD (the form the astro fn expects). */
function dashed(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Build an ICS calendar for a trip (C6). `baseDate`/`stamp` (YYYYMMDD / ISO-basic) passed by caller.
 * When `opts.sun` is provided (ADR-048), bakes the night's dark-sky facts (moon %, hours of astronomical
 * darkness) into each event for stops with coordinates — kept INJECTED so this function stays pure and
 * the existing tests (no `sun`) are unaffected.
 */
export function tripToIcs(trip: Trip, opts: { baseDate: string; stamp: string; sun?: SunTimesFn }): string {
  const baseDate = toYYYYMMDD(trip.startDate) ?? opts.baseDate;
  const stops = ((trip.stops ?? []).filter(Boolean) as {
    id: string;
    day?: number | null;
    parkName?: string;
    name?: string;
    lat?: number | null;
    lng?: number | null;
  }[]);
  const events: IcsAllDayEvent[] = stops.map((s, i) => {
    const date = addDays(baseDate, (s.day ?? i + 1) - 1);
    let description = 'TrailGraph itinerary — verify hours/closures at nps.gov before you go.';
    if (opts.sun && s.lat != null && s.lng != null) {
      const sky = opts.sun(s.lat, s.lng, dashed(date));
      if (sky) {
        const dark = sky.darkHours != null ? ` · ~${sky.darkHours}h of astronomical darkness` : '';
        description = `🌙 Moon ${sky.moonIllumination}% illuminated${dark}. ${description}`;
      }
    }
    return {
      uid: `${s.id}@trailgraph`,
      date,
      summary: s.parkName ?? s.name ?? 'Stop',
      description,
    };
  });
  return generateICS(trip.name ?? 'TrailGraph Trip', events, opts.stamp);
}
