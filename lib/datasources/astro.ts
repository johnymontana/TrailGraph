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
import * as satellite from 'satellite.js';
import type { Tle } from './tle';

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

// =================================================================================================
// Astro Command Center extensions (ADR-055): meteor showers, satellite passes, shot planning. Pure
// (meteor/shot) or pure-given-TLE (passes) so they unit-test deterministically by fixing the date.
// =================================================================================================

/** Smallest absolute angle between two azimuths (0..180). Pure. */
function azimuthDelta(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function ymdMs(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`);
}
function monthDayMs(year: number, mmdd: string): number {
  return Date.parse(`${year}-${mmdd}T00:00:00Z`);
}

// --- Meteor showers -------------------------------------------------------------------------------

export interface MeteorShower {
  name: string;
  peak: string; // 'MM-DD'
  zhr: number; // zenithal hourly rate at peak
  activeStart: string; // 'MM-DD'
  activeEnd: string; // 'MM-DD' (may wrap the new year, e.g. Quadrantids)
  radiant: string; // origin constellation
  parent: string; // parent comet/asteroid
}

export interface ActiveMeteorShower {
  name: string;
  zhr: number;
  radiant: string;
  parent: string;
  peakDate: string; // ISO YYYY-MM-DD of the nearest peak
  daysToPeak: number; // >0 upcoming, 0 tonight, <0 just past
  intensityPct: number; // Gaussian falloff around peak, 0..100
  isPeakTonight: boolean;
}

/** Curated annual major showers (IMO calendar). A constant like `darksky.ts` — peaks shift ≤1 day/yr. */
export const METEOR_SHOWERS: MeteorShower[] = [
  { name: 'Quadrantids', peak: '01-03', zhr: 110, activeStart: '12-28', activeEnd: '01-12', radiant: 'Boötes', parent: '2003 EH1' },
  { name: 'Lyrids', peak: '04-22', zhr: 18, activeStart: '04-16', activeEnd: '04-25', radiant: 'Lyra', parent: 'Comet Thatcher' },
  { name: 'Eta Aquariids', peak: '05-06', zhr: 50, activeStart: '04-19', activeEnd: '05-28', radiant: 'Aquarius', parent: 'Halley' },
  { name: 'Delta Aquariids', peak: '07-30', zhr: 25, activeStart: '07-12', activeEnd: '08-23', radiant: 'Aquarius', parent: '96P/Machholz' },
  { name: 'Perseids', peak: '08-12', zhr: 100, activeStart: '07-17', activeEnd: '08-24', radiant: 'Perseus', parent: 'Swift–Tuttle' },
  { name: 'Draconids', peak: '10-08', zhr: 10, activeStart: '10-06', activeEnd: '10-10', radiant: 'Draco', parent: '21P/Giacobini–Zinner' },
  { name: 'Orionids', peak: '10-21', zhr: 20, activeStart: '10-02', activeEnd: '11-07', radiant: 'Orion', parent: 'Halley' },
  { name: 'Leonids', peak: '11-17', zhr: 15, activeStart: '11-06', activeEnd: '11-30', radiant: 'Leo', parent: '55P/Tempel–Tuttle' },
  { name: 'Geminids', peak: '12-14', zhr: 150, activeStart: '12-04', activeEnd: '12-17', radiant: 'Gemini', parent: '3200 Phaethon' },
  { name: 'Ursids', peak: '12-22', zhr: 10, activeStart: '12-17', activeEnd: '12-26', radiant: 'Ursa Minor', parent: '8P/Tuttle' },
];

function nearestPeak(ymd: string, peak: string): { days: number; isoDate: string } {
  const base = ymdMs(ymd);
  const y = new Date(base).getUTCFullYear();
  let best = { days: Number.POSITIVE_INFINITY, ms: 0 };
  for (const yr of [y - 1, y, y + 1]) {
    const ms = monthDayMs(yr, peak);
    const days = Math.round((ms - base) / 86_400_000);
    if (Math.abs(days) < Math.abs(best.days)) best = { days, ms };
  }
  return { days: best.days, isoDate: new Date(best.ms).toISOString().slice(0, 10) };
}

function inWindow(ymd: string, start: string, end: string): boolean {
  const d = ymdMs(ymd);
  const y = new Date(d).getUTCFullYear();
  for (const yr of [y - 1, y, y + 1]) {
    const s = monthDayMs(yr, start);
    let e = monthDayMs(yr, end) + 86_399_000;
    if (e < s) e = monthDayMs(yr + 1, end) + 86_399_000; // wraps the new year (e.g. Dec 28 → Jan 12)
    if (d >= s && d <= e) return true;
  }
  return false;
}

/**
 * Showers active on `date` (default today), with a Gaussian intensity around the peak (σ≈2.5 days) and
 * "days to peak". Pure (unit-tested). Moon wash is layered in by the caller (the tool already has the
 * moon illumination) — kept out here so the table stays a pure derivation.
 */
export function meteorShowers(date?: string): ActiveMeteorShower[] {
  const ymd = date ?? todayYmd();
  const out: ActiveMeteorShower[] = [];
  for (const s of METEOR_SHOWERS) {
    if (!inWindow(ymd, s.activeStart, s.activeEnd)) continue;
    const { days, isoDate } = nearestPeak(ymd, s.peak);
    const intensityPct = Math.round(100 * Math.exp(-0.5 * (days / 2.5) ** 2));
    out.push({
      name: s.name,
      zhr: s.zhr,
      radiant: s.radiant,
      parent: s.parent,
      peakDate: isoDate,
      daysToPeak: days,
      intensityPct,
      isPeakTonight: days === 0,
    });
  }
  return out.sort((a, b) => b.intensityPct - a.intensityPct || Math.abs(a.daysToPeak) - Math.abs(b.daysToPeak));
}

// --- Satellite passes -----------------------------------------------------------------------------

export interface SatellitePass {
  name: string;
  start: string; // ISO
  peak: string; // ISO of max elevation
  end: string; // ISO
  maxElevationDeg: number;
  startAzimuthDeg: number;
  endAzimuthDeg: number;
  durationMin: number;
  visible: boolean; // satellite sunlit AND observer in darkness/twilight (naked-eye visible pass)
}

interface PassBuild {
  start: Date;
  end: Date;
  startAz: number;
  endAz: number;
  peakEl: number;
  peakT: Date;
  peakPos: satellite.EciVec3<number>;
}

/** Observer's sun altitude (deg) at a given instant — for the "is it dark enough to see passes" gate. */
function sunAltitudeDeg(obs: Observer, t: Date): number {
  const at = MakeTime(t);
  const eq = Equator(Body.Sun, at, obs, true, true);
  return Horizon(at, obs, eq.ra, eq.dec, 'normal').altitude;
}

/** True when the satellite is sunlit (out of Earth's shadow) at `t`, via satellite.js sun + shadow. */
function satelliteSunlit(pos: satellite.EciVec3<number>, t: Date): boolean {
  const sun = satellite.sunPos(satellite.jday(t));
  return satellite.shadowFraction(sun.rsun, pos) < 0.5;
}

function finalizePass(name: string, cur: PassBuild, obs: Observer): SatellitePass {
  const sunAlt = sunAltitudeDeg(obs, cur.peakT);
  const visible = sunAlt <= -6 && satelliteSunlit(cur.peakPos, cur.peakT); // dark/twilight observer + lit sat
  return {
    name,
    start: cur.start.toISOString(),
    peak: cur.peakT.toISOString(),
    end: cur.end.toISOString(),
    maxElevationDeg: Math.round(cur.peakEl),
    startAzimuthDeg: Math.round(cur.startAz),
    endAzimuthDeg: Math.round(cur.endAz),
    durationMin: Math.round(((cur.end.getTime() - cur.start.getTime()) / 60_000) * 10) / 10,
    visible,
  };
}

/**
 * Visible/over-horizon passes for the given TLEs over the 24h from `date` noon UTC (spans the night at US
 * longitudes). SGP4 via satellite.js; a pass is an interval where elevation ≥ `minElevationDeg`, marked
 * `visible` when the observer is in darkness/twilight and the satellite is sunlit. Pure given the TLEs
 * (unit-tested with the canonical ISS fixture near its epoch). Cheap: a handful of sats × 30s steps.
 */
export function satellitePasses(
  lat: number,
  lng: number,
  tles: Tle[],
  date?: string,
  opts?: { minElevationDeg?: number; stepSec?: number; visibleOnly?: boolean },
): SatellitePass[] {
  const ymd = date ?? todayYmd();
  const minEl = opts?.minElevationDeg ?? 10;
  const stepSec = opts?.stepSec ?? 30;
  const obsGd = {
    longitude: satellite.degreesToRadians(lng),
    latitude: satellite.degreesToRadians(lat),
    height: 0,
  };
  const obs = new Observer(lat, lng, 0);
  const startMs = ymdMs(ymd) + 12 * 3_600_000;
  const passes: SatellitePass[] = [];

  for (const tle of tles) {
    let satrec: satellite.SatRec;
    try {
      satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    } catch {
      continue;
    }
    let cur: PassBuild | null = null;
    for (let s = 0; s <= 86_400; s += stepSec) {
      const t = new Date(startMs + s * 1000);
      let pv: satellite.PositionAndVelocity | null;
      try {
        pv = satellite.propagate(satrec, t);
      } catch {
        cur = null;
        continue;
      }
      if (!pv || !pv.position) continue;
      const gmst = satellite.gstime(t);
      const ecf = satellite.eciToEcf(pv.position, gmst);
      const look = satellite.ecfToLookAngles(obsGd, ecf);
      const elDeg = satellite.radiansToDegrees(look.elevation);
      if (elDeg >= minEl) {
        const azDeg = ((satellite.radiansToDegrees(look.azimuth) % 360) + 360) % 360;
        if (!cur) {
          cur = { start: t, end: t, startAz: azDeg, endAz: azDeg, peakEl: elDeg, peakT: t, peakPos: pv.position };
        } else {
          cur.end = t;
          cur.endAz = azDeg;
          if (elDeg > cur.peakEl) {
            cur.peakEl = elDeg;
            cur.peakT = t;
            cur.peakPos = pv.position;
          }
        }
      } else if (cur) {
        passes.push(finalizePass(tle.name, cur, obs));
        cur = null;
      }
    }
    if (cur) passes.push(finalizePass(tle.name, cur, obs));
  }

  const filtered = opts?.visibleOnly ? passes.filter((p) => p.visible) : passes;
  return filtered.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// --- Shot planning --------------------------------------------------------------------------------

export interface ShotAlignment {
  time: string; // ISO of best alignment
  azimuthDeg: number; // core azimuth at that time
  altitudeDeg: number; // core altitude at that time
  deltaDeg: number; // |core azimuth − foreground bearing|
}

export interface ShotPlan {
  date: string;
  foregroundAzimuthDeg: number;
  coreVisible: boolean;
  aligned: boolean; // best alignment within tolerance
  toleranceDeg: number;
  bestAlignment: ShotAlignment | null;
  moonIlluminationPct: number;
  moonInterference: 'none' | 'low' | 'moderate' | 'high';
  window: DarkHoursInfo;
  advice: string;
}

function moonInterferenceLevel(pct: number): ShotPlan['moonInterference'] {
  if (pct < 10) return 'none';
  if (pct < 35) return 'low';
  if (pct < 70) return 'moderate';
  return 'high';
}

function moonAdvice(level: ShotPlan['moonInterference']): string {
  switch (level) {
    case 'none':
      return 'new-moon dark skies — ideal for the core';
    case 'low':
      return 'a thin moon adds minimal wash';
    case 'moderate':
      return 'a half-lit moon will wash faint nebulosity — shoot when it is below the horizon';
    case 'high':
      return 'a bright moon dominates — pick a date nearer new moon';
  }
}

/**
 * Astrophotography shot planner (ADR-055): when does the Milky-Way core line up over a foreground at
 * bearing `foregroundAzimuthDeg`? Samples the astronomical-darkness window in 5-min steps for the core's
 * (Sgr A*) azimuth/altitude, returns the closest alignment + moon-wash advice. Pure/deterministic.
 */
export function shotPlan(lat: number, lng: number, foregroundAzimuthDeg: number, date?: string): ShotPlan {
  const ymd = date ?? todayYmd();
  const a = getAstro(lat, lng, ymd);
  const obs = new Observer(lat, lng, 0);
  const fg = ((foregroundAzimuthDeg % 360) + 360) % 360;
  const toleranceDeg = 20;
  const moonIlluminationPct = a.moon.illuminationPct;
  const moonInterference = moonInterferenceLevel(moonIlluminationPct);

  let best: ShotAlignment | null = null;
  if (a.darkHours.start && a.darkHours.end) {
    DefineStar(Body.Star1, SGR_A_RA_HOURS, SGR_A_DEC_DEG, 1000);
    const startMs = Date.parse(a.darkHours.start);
    const endMs = Date.parse(a.darkHours.end);
    for (let ms = startMs; ms <= endMs; ms += 5 * 60_000) {
      const t = MakeTime(new Date(ms));
      const eq = Equator(Body.Star1, t, obs, true, true);
      const hor = Horizon(t, obs, eq.ra, eq.dec, 'normal');
      if (hor.altitude <= 0) continue;
      const delta = azimuthDelta(hor.azimuth, fg);
      if (!best || delta < best.deltaDeg) {
        best = {
          time: new Date(ms).toISOString(),
          azimuthDeg: Math.round(hor.azimuth),
          altitudeDeg: Math.round(hor.altitude),
          deltaDeg: Math.round(delta),
        };
      }
    }
  }

  // "Visible" in the shot sense = the core actually clears the horizon DURING astronomical darkness (not
  // merely above the horizon at some point in the 24h, which can be midday in winter).
  const coreVisible = best !== null;
  const aligned = !!best && best.deltaDeg <= toleranceDeg;
  let advice: string;
  if (!a.darkHours.start || !a.darkHours.end) {
    advice = 'No astronomical darkness on this date (high latitude / midsummer) — the sky never fully darkens.';
  } else if (!best) {
    advice = 'The core is above the horizon only in daylight on this date — core season is roughly May–September.';
  } else if (aligned) {
    advice = `The core sits ${best.altitudeDeg}° up over your foreground (az ${best.azimuthDeg}°, ${best.deltaDeg}° off) — ${moonAdvice(moonInterference)}.`;
  } else {
    advice = `Closest the core gets to your foreground is ${best.deltaDeg}° off — reframe toward az ${best.azimuthDeg}° for alignment. ${moonAdvice(moonInterference)}.`;
  }

  return {
    date: ymd,
    foregroundAzimuthDeg: Math.round(fg),
    coreVisible,
    aligned,
    toleranceDeg,
    bestAlignment: best,
    moonIlluminationPct,
    moonInterference,
    window: a.darkHours,
    advice,
  };
}
