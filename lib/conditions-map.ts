/**
 * Condition-aware map scorer (#4): given already-fetched per-park facts for a target date, produce a
 * 0–100 score + a category the map recolors by. PURE (no I/O) so it's unit-tested and cheap; the BFF
 * (op=conditions, future step) does the orchestration — pulling graph facts (open state, alerts, crowd,
 * fee-free) + runtime weather/astro — then calls this per park.
 *
 * Null handling is first-class (sparse data / no forecast beyond ~16 days): missing signals are neutral,
 * never silently "good". A closed park or an active closure/danger alert overrides to 'closed'; when we
 * have essentially no signal we say 'unknown' rather than guess.
 */
import type { ColorMode } from '../components/ui/color-mode';

export type ConditionCategory = 'good' | 'fair' | 'poor' | 'closed' | 'unknown';

export interface ConditionFacts {
  /** Open state for the date (from operatingHours / seasonalClosureSummary). */
  open: 'open' | 'closed' | 'unknown';
  /** An active Closure/Danger alert affects the park. */
  alert: boolean;
  /** Forecast is clear / mostly clear for the date; null = no forecast (date out of horizon / fetch failed). */
  clearSky: boolean | null;
  /** Moon illumination 0–100 for the date (lower = darker skies); null = not computed. */
  moonIlluminationPct: number | null;
  /** Crowd level for the park; null = not synced. */
  crowdLevel: 'low' | 'moderate' | 'high' | 'very high' | null;
  /** The date is a national fee-free day. */
  feeFree: boolean;
}

export interface ConditionScore {
  score: number; // 0–100
  category: ConditionCategory;
}

/** Clamp to [0, 100]. */
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Score a park's visit-worthiness for a date. Order matters: a hard closure (closed for the date, or an
 * active closure/danger alert) wins outright; otherwise we accumulate from a neutral 50 baseline and bucket.
 */
export function scoreMapCondition(f: ConditionFacts): ConditionScore {
  // Hard overrides first — never present a closed/alerted park as merely "poor".
  if (f.open === 'closed' || f.alert) return { score: 0, category: 'closed' };

  // No meaningful signal at all → be honest rather than guess.
  if (f.open === 'unknown' && f.clearSky === null && f.crowdLevel === null) {
    return { score: 0, category: 'unknown' };
  }

  let s = 50;
  if (f.open === 'open') s += 15; // 'unknown' is neutral

  if (f.clearSky === true) s += 20;
  else if (f.clearSky === false) s -= 15; // null → neutral

  switch (f.crowdLevel) {
    case 'low': s += 15; break;
    case 'moderate': s += 5; break;
    case 'high': s -= 10; break;
    case 'very high': s -= 20; break;
    default: break; // null → neutral
  }

  // Dark-sky bonus (a clear new-moon night is a stargazing draw).
  if (f.moonIlluminationPct != null) {
    if (f.moonIlluminationPct < 25) s += 10;
    else if (f.moonIlluminationPct < 50) s += 5;
    else if (f.moonIlluminationPct >= 75) s -= 5;
  }

  if (f.feeFree) s += 5;

  const score = clamp(s);
  const category: ConditionCategory = score >= 70 ? 'good' : score >= 45 ? 'fair' : 'poor';
  return { score, category };
}

/** Map a weather condition label (lib/datasources/weather weatherCodeLabel) to a clear-sky boolean, or
 * null when there's no forecast for the date. Pure (unit-tested). */
export function clearSkyFromCondition(condition: string | null | undefined): boolean | null {
  if (!condition) return null;
  return /clear|partly/i.test(condition);
}

// ── Category colors for the map recolor + legend (canvas hex per color mode, like lib/mapLenses). ──
const CATEGORY_SWATCH: Record<ConditionCategory, { label: string; light: string; dark: string }> = {
  good: { label: 'Good', light: '#2E7D52', dark: '#4FB07A' },
  fair: { label: 'Fair', light: '#C4922E', dark: '#E0B64A' },
  poor: { label: 'Poor', light: '#D9772E', dark: '#EC9450' },
  closed: { label: 'Closed / alert', light: '#C84030', dark: '#E66552' },
  // Faded for "no data": mid-dark on light bg (sand[600]), mid-light on dark bg (sand[400]).
  unknown: { label: 'No data', light: '#8A7B5C', dark: '#C7BA9C' },
};
const CATEGORY_ORDER: ConditionCategory[] = ['good', 'fair', 'poor', 'closed', 'unknown'];

export function conditionColor(category: ConditionCategory, mode: ColorMode | undefined): string {
  const s = CATEGORY_SWATCH[category];
  return mode === 'dark' ? s.dark : s.light;
}

export function conditionLegend(mode: ColorMode | undefined): { key: string; label: string; color: string }[] {
  return CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_SWATCH[c].label, color: conditionColor(c, mode) }));
}

/** Flattened [value, color, …] stops for a MapLibre ['match', ['get','condCategory'], …] expression; the
 * 'unknown' color is the match default. Kept as data (no maplibre-gl import); the map assembles it. */
export function conditionMatchStops(mode: ColorMode | undefined): string[] {
  const stops: string[] = [];
  for (const c of CATEGORY_ORDER) {
    if (c === 'unknown') continue;
    stops.push(c, conditionColor(c, mode));
  }
  return stops;
}
export const conditionDefaultColor = (mode: ColorMode | undefined): string => conditionColor('unknown', mode);
