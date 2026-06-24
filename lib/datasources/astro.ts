import {
  Body,
  DefineStar,
  Equator,
  Horizon,
  Illumination,
  MakeTime,
  MoonPhase,
  Observer,
  SearchAltitude,
  SearchHourAngle,
  SearchRiseSet,
  type AstroTime,
} from 'astronomy-engine';

/**
 * Deterministic astronomy data source (§5.4 / ADR-043, the "compute" half of the compute-or-link policy).
 * Pure ephemeris from lat/lng + date via `astronomy-engine` — NO external API, NO fabrication: moon
 * phase/illumination, sun + civil/nautical/astronomical twilight, "dark hours", and the Milky-Way
 * galactic-core (Sgr A*) rise/set + azimuth. Server-only (only imported by the RSC park page and the
 * `get_astro` agent tool), so the library never enters the client bundle.
 *
 * Times are UTC ISO strings — the *client* card formats to the viewer's locale; the timezone-independent
 * fields (illumination %, phase, darkHours) are what server surfaces (the park page) render directly,
 * since a park-local clock needs a tz lookup (deferred to the Phase-2 astro-planner).
 */

// Galactic center, Sagittarius A* (J2000): RA 17h45m40s ≈ 17.7611 sidereal-hours, Dec −29.00781°.
const SGR_A_RA_HOURS = 17.7611;
const SGR_A_DEC_DEG = -29.00781;

export interface MoonInfo {
  phaseName: string;
  phaseAngleDeg: number;
  illuminationPct: number;
  emoji: string;
  rise: string | null;
  set: string | null;
}
export interface SunInfo {
  rise: string | null;
  set: string | null;
}
export interface TwilightInfo {
  civilDusk: string | null;
  nauticalDusk: string | null;
  astronomicalDusk: string | null;
  astronomicalDawn: string | null;
  nauticalDawn: string | null;
  civilDawn: string | null;
}
export interface DarkHoursInfo {
  start: string | null;
  end: string | null;
  hours: number | null;
}
export interface GalacticCoreInfo {
  rise: string | null;
  set: string | null;
  riseAzimuthDeg: number | null;
  maxAltitudeDeg: number | null;
  visible: boolean;
}
export interface AstroEvents {
  date: string; // YYYY-MM-DD anchor
  moon: MoonInfo;
  sun: SunInfo;
  twilight: TwilightInfo;
  darkHours: DarkHoursInfo;
  galacticCore: GalacticCoreInfo;
}

export interface SqmEstimate {
  sqm: number;
  estimate: true;
  label: string;
}

/**
 * Compact, timezone-INDEPENDENT astro facts for baking into ICS exports (ADR-048): moon illumination %
 * and hours of astronomical darkness. We omit clock times here because an all-day calendar event has no
 * timezone and the park-local clock needs a tz lookup (deferred to the Phase-2 astro-planner) — folding
 * in wrong-tz times would violate the honesty policy (ADR-043).
 */
export interface SunTimes {
  moonIllumination: number;
  darkHours: number | null;
}
export function sunTimesFor(lat: number, lng: number, date: string): SunTimes {
  const a = getAstro(lat, lng, date);
  return { moonIllumination: a.moon.illuminationPct, darkHours: a.darkHours.hours };
}

/** Moon ecliptic-longitude phase angle (0..360) → friendly name + emoji. Pure (unit-tested). */
export function moonPhaseName(angleDeg: number): { name: string; emoji: string } {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return { name: 'New', emoji: '🌑' };
  if (a < 67.5) return { name: 'Waxing crescent', emoji: '🌒' };
  if (a < 112.5) return { name: 'First quarter', emoji: '🌓' };
  if (a < 157.5) return { name: 'Waxing gibbous', emoji: '🌔' };
  if (a < 202.5) return { name: 'Full', emoji: '🌕' };
  if (a < 247.5) return { name: 'Waning gibbous', emoji: '🌖' };
  if (a < 292.5) return { name: 'Last quarter', emoji: '🌗' };
  return { name: 'Waning crescent', emoji: '🌘' };
}

/**
 * SQM (mag/arcsec²) ESTIMATED from the Bortle scale (ADR-043 — labeled estimate, never a measurement).
 * Linear interpolation across a published Bortle↔SQM table (B1≈21.95 … B9≈17.8). Pure (unit-tested).
 */
export function sqmFromBortle(bortle: number): SqmEstimate {
  const b = Math.min(9, Math.max(1, bortle));
  const sqm = Math.round((21.95 - (b - 1) * 0.52) * 100) / 100; // B1→21.95, B9→17.79
  return { sqm, estimate: true, label: `Est. from Bortle ${bortle}` };
}

function iso(t: AstroTime | null): string | null {
  return t ? t.date.toISOString() : null;
}

/** Hours between two AstroTimes, rounded to 0.1; null if either is missing. */
function hoursBetween(a: AstroTime | null, b: AstroTime | null): number | null {
  if (!a || !b) return null;
  return Math.round(((b.date.getTime() - a.date.getTime()) / 3_600_000) * 10) / 10;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute tonight's astronomy for a location. `date` is `YYYY-MM-DD` (defaults to today). Deterministic:
 * same inputs → same output. Searches anchor at noon UTC so "tonight" resolves at US longitudes.
 */
export function getAstro(lat: number, lng: number, date?: string): AstroEvents {
  const ymd = date ?? todayYmd();
  const obs = new Observer(lat, lng, 0);
  const anchor = MakeTime(new Date(`${ymd}T12:00:00Z`));

  // Moon
  const illum = Illumination(Body.Moon, anchor);
  const phaseAngle = MoonPhase(anchor);
  const phase = moonPhaseName(phaseAngle);
  const moon: MoonInfo = {
    phaseName: phase.name,
    phaseAngleDeg: Math.round(phaseAngle * 10) / 10,
    illuminationPct: Math.round(illum.phase_fraction * 100),
    emoji: phase.emoji,
    rise: iso(SearchRiseSet(Body.Moon, obs, +1, anchor, 1)),
    set: iso(SearchRiseSet(Body.Moon, obs, -1, anchor, 1)),
  };

  // Sun rise/set
  const sun: SunInfo = {
    rise: iso(SearchRiseSet(Body.Sun, obs, +1, anchor, 1)),
    set: iso(SearchRiseSet(Body.Sun, obs, -1, anchor, 1)),
  };

  // Twilight: evening dusk = Sun descending (-1) through −6/−12/−18; morning dawn = ascending (+1).
  const civilDusk = SearchAltitude(Body.Sun, obs, -1, anchor, 1, -6);
  const nauticalDusk = SearchAltitude(Body.Sun, obs, -1, anchor, 1, -12);
  const astronomicalDusk = SearchAltitude(Body.Sun, obs, -1, anchor, 1, -18);
  // Dawn searches start from the dusk crossing (or anchor when there's no astronomical night).
  const dawnAnchor = astronomicalDusk ?? anchor;
  const astronomicalDawn = SearchAltitude(Body.Sun, obs, +1, dawnAnchor, 1, -18);
  const nauticalDawn = SearchAltitude(Body.Sun, obs, +1, nauticalDusk ?? anchor, 1, -12);
  const civilDawn = SearchAltitude(Body.Sun, obs, +1, civilDusk ?? anchor, 1, -6);
  const twilight: TwilightInfo = {
    civilDusk: iso(civilDusk),
    nauticalDusk: iso(nauticalDusk),
    astronomicalDusk: iso(astronomicalDusk),
    astronomicalDawn: iso(astronomicalDawn),
    nauticalDawn: iso(nauticalDawn),
    civilDawn: iso(civilDawn),
  };
  const darkHours: DarkHoursInfo = {
    start: iso(astronomicalDusk),
    end: iso(astronomicalDawn),
    hours: hoursBetween(astronomicalDusk, astronomicalDawn),
  };

  // Galactic core (Sgr A*). DefineStar mutates the global Star1 slot — getAstro is synchronous and
  // single-path, so define it immediately before use.
  DefineStar(Body.Star1, SGR_A_RA_HOURS, SGR_A_DEC_DEG, 1000);
  const coreRise = SearchRiseSet(Body.Star1, obs, +1, anchor, 1);
  const coreSet = SearchRiseSet(Body.Star1, obs, -1, anchor, 1);
  let riseAzimuthDeg: number | null = null;
  if (coreRise) {
    const eq = Equator(Body.Star1, coreRise, obs, true, true);
    riseAzimuthDeg = Math.round(Horizon(coreRise, obs, eq.ra, eq.dec, 'normal').azimuth);
  }
  const transit = SearchHourAngle(Body.Star1, obs, 0, anchor, +1);
  const maxAltitudeDeg = transit ? Math.round(transit.hor.altitude) : null;
  const galacticCore: GalacticCoreInfo = {
    rise: iso(coreRise),
    set: iso(coreSet),
    riseAzimuthDeg,
    maxAltitudeDeg,
    visible: maxAltitudeDeg != null && maxAltitudeDeg > 0,
  };

  return { date: ymd, moon, sun, twilight, darkHours, galacticCore };
}
