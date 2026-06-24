import { darkSkyRating } from './datasources/darksky';
import { deriveBestMonths, normalizeCrowdCurve } from './datasources/visitation';
import type { DayForecast } from './datasources/weather';

/**
 * Pure data-shapers for the park-detail chart suite. Server-safe (no DB/network deps) — the RSC park
 * page calls these to precompute chart props, then passes plain objects to the `'use client'` chart
 * components. Deterministic + unit-tested. No heavy imports (lightweight datasources only) so this stays
 * cheap to import anywhere; client components type-only-import the result shapes.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ---- 1. Park fingerprint (radar) -----------------------------------------------------------------

export interface FingerprintAxis {
  axis: string;
  value: number; // 0–100
}

export interface FingerprintInput {
  activities?: string[];
  topics?: string[];
  thingsToDo?: { difficulty?: string | null; length?: number | null; elevationGain?: number | null }[];
  bortleScale?: number | null;
  crowdLevel?: string | null;
}

const AXIS_KEYWORDS: Record<string, string[]> = {
  Water: ['boating', 'fishing', 'paddling', 'swimming', 'lakes', 'rivers', 'streams', 'waterfall', 'beach', 'snorkel', 'surf'],
  Wildlife: ['wildlife', 'birdwatching', 'bird', 'animals', 'fish'],
  'History & culture': ['arts and culture', 'historic', 'cultural', 'archeology', 'architecture', 'people and identity', 'military'],
};

function keywordScore(haystack: string[], keywords: string[]): number {
  const hay = haystack.map((h) => h.toLowerCase());
  const matched = keywords.filter((k) => hay.some((h) => h.includes(k))).length;
  return clamp100(matched * 35); // 1 match → 35, 3+ → 100
}

const CROWD_SOLITUDE: Record<string, number> = { low: 92, moderate: 62, high: 32, 'very high': 12 };

/** A 6-axis "personality" radar from a park's activities/topics/dark-sky/crowd/trails. Pure. */
export function parkFingerprint(p: FingerprintInput): FingerprintAxis[] {
  const activities = p.activities ?? [];
  const topics = p.topics ?? [];
  const tags = [...activities, ...topics];
  const trails = p.thingsToDo?.length ?? 0;
  const solitude = p.crowdLevel ? (CROWD_SOLITUDE[p.crowdLevel] ?? 50) : 50;
  const darkSky = p.bortleScale != null ? clamp100(((9 - p.bortleScale) / 8) * 100) : 0;
  return [
    { axis: 'Trails', value: clamp100(trails * 9) }, // ~11 trails → 100
    { axis: 'Dark sky', value: darkSky },
    { axis: 'Solitude', value: solitude },
    { axis: 'Water', value: keywordScore(tags, AXIS_KEYWORDS.Water) },
    { axis: 'Wildlife', value: keywordScore(tags, AXIS_KEYWORDS.Wildlife) },
    { axis: 'History & culture', value: keywordScore(tags, AXIS_KEYWORDS['History & culture']) },
  ];
}

// ---- 2. Trail difficulty (donut) + 3. trail profile (scatter) ------------------------------------

export type TrailDifficulty = 'easy' | 'moderate' | 'strenuous' | 'unknown';
const DIFFICULTIES: TrailDifficulty[] = ['easy', 'moderate', 'strenuous'];

interface ThingToDo {
  title?: string;
  difficulty?: string | null;
  length?: number | null;
  elevationGain?: number | null;
}

function normalizeDifficulty(d: string | null | undefined): TrailDifficulty {
  const s = (d ?? '').toLowerCase();
  if (s.includes('strenuous') || s.includes('difficult') || s.includes('hard')) return 'strenuous';
  if (s.includes('moderate')) return 'moderate';
  if (s.includes('easy')) return 'easy';
  return 'unknown';
}

export interface DifficultySlice {
  difficulty: TrailDifficulty;
  count: number;
}

/** Counts of easy/moderate/strenuous trails (drops empty buckets; 'unknown' last). Pure. */
export function trailDifficultyBreakdown(thingsToDo: ThingToDo[] | undefined): DifficultySlice[] {
  const counts: Record<TrailDifficulty, number> = { easy: 0, moderate: 0, strenuous: 0, unknown: 0 };
  for (const t of thingsToDo ?? []) counts[normalizeDifficulty(t.difficulty)]++;
  return [...DIFFICULTIES, 'unknown' as const]
    .map((difficulty) => ({ difficulty, count: counts[difficulty] }))
    .filter((s) => s.count > 0);
}

export interface ScatterTrail {
  title: string;
  length: number;
  elevationGain: number;
  difficulty: TrailDifficulty;
}

/** Trails with BOTH length + elevation, for a length×elevation scatter. Pure. */
export function trailScatterData(thingsToDo: ThingToDo[] | undefined): ScatterTrail[] {
  return (thingsToDo ?? [])
    .filter((t) => t.length != null && t.length > 0 && t.elevationGain != null && t.elevationGain >= 0)
    .map((t) => ({
      title: t.title ?? 'Trail',
      length: Math.round((t.length as number) * 10) / 10,
      elevationGain: Math.round(t.elevationGain as number),
      difficulty: normalizeDifficulty(t.difficulty),
    }));
}

// ---- 4. Dark-sky gauge (radial) ------------------------------------------------------------------

export interface DarkSkyGauge {
  bortle: number;
  sqm: number; // mag/arcsec² estimate
  stars: number;
  label: string;
  fillPct: number; // 0–100, darker sky = fuller gauge
}

/** Dark-sky gauge data: Bortle → SQM estimate + 5-star rating + a darker-is-fuller fill. Null if no data. */
export function darkSkyGaugeData(bortle: number | null | undefined): DarkSkyGauge | null {
  if (bortle == null) return null;
  const b = Math.min(9, Math.max(1, bortle));
  const sqm = Math.round((21.95 - (b - 1) * 0.52) * 100) / 100; // mirror sqmFromBortle (no heavy import)
  const { stars, label } = darkSkyRating(b);
  return { bortle: b, sqm, stars, label, fillPct: clamp100(((9 - b) / 8) * 100) };
}

// ---- 5. 3-day temperature range (area band) ------------------------------------------------------

export interface WeatherRangePoint {
  day: string; // 'Mon'
  hi: number;
  lo: number;
}

/** 3-day forecast → hi/lo band points. Pure. */
export function weatherRangeData(daily: DayForecast[] | undefined): WeatherRangePoint[] {
  return (daily ?? []).map((d) => ({
    day: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    hi: Math.round(d.hiF),
    lo: Math.round(d.loF),
  }));
}

// ---- 6. Best-time-to-visit calendar (month heatmap) ----------------------------------------------

export interface CrowdHeatCell {
  month: string; // 'Jan'
  visits: number;
  pct: number; // 0–100 of the busiest month (intensity)
  best: boolean; // a lowest-crowd month → recommended
}

/** 12-cell month heatmap: relative crowding intensity + the lowest-crowd ("best") months. Pure. */
export function crowdHeatmap(monthly: number[] | undefined): CrowdHeatCell[] {
  const m = monthly ?? [];
  if (m.length !== 12) return [];
  const curve = normalizeCrowdCurve(m);
  const best = new Set(deriveBestMonths(m)); // 1-indexed
  return curve.map((c, i) => ({ month: MONTHS[i], visits: c.visits, pct: c.pct, best: best.has(i + 1) }));
}
