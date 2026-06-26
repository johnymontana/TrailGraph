/**
 * Data lenses (#3): recolor the whole parks layer by a chosen variable — dark-sky (Bortle), crowds,
 * entry fee, or accessibility — instead of designation. Pure: each lens emits a MapLibre `circle-color`
 * expression over the per-park feature props baked in MapExplorer, plus a matching legend. Colors are
 * canvas hex resolved per color mode (like lib/brandColors / lib/mapLegend).
 *
 * Sparse data is first-class: bortleScale (~15 parks) / crowdLevel (~400) are null until
 * `pnpm datasources:sync`, so every lens has an explicit "No data" bucket (faded) — we never imply, e.g.,
 * Bortle 9 for an unmapped park. bortleScale is baked as `?? -1` so the step's base bucket = No data.
 */
import type { ColorMode } from '../components/ui/color-mode';
import { pine, sand } from '../theme/colors';

export type LensKey = 'none' | 'darksky' | 'crowd' | 'fee' | 'accessibility';

export const MAP_LENSES: { key: LensKey; label: string }[] = [
  { key: 'none', label: 'Designation' },
  { key: 'darksky', label: 'Dark sky' },
  { key: 'crowd', label: 'Crowds' },
  { key: 'fee', label: 'Entry fee' },
  { key: 'accessibility', label: 'Accessibility' },
];

export interface LensLegendEntry {
  key: string;
  label: string;
  color: string;
}

interface Swatch {
  key: string;
  label: string;
  light: string;
  dark: string;
}

const pick = (s: Swatch, mode: ColorMode | undefined) => (mode === 'dark' ? s.dark : s.light);

// Faded "no data": mid-dark on light bg, mid-light on dark bg (visible against either basemap).
const NO_DATA: Swatch = { key: 'nodata', label: 'No data', light: sand[600], dark: sand[400] };
// fee + accessibility are CORE boolean facets (allParksGeo coalesces feeFree→false and derives `accessible`
// via EXISTS), so there's no nullable "not synced" state to surface — unlike the sparse bortle/crowd lenses.
// A park is shown free vs paying, accessible vs not-reported; "Not reported" intentionally covers both
// "no accessible campground" and "camping not mapped" (we can't distinguish them from a boolean EXISTS).
const FREE: Swatch = { key: 'free', label: 'Free entry', light: pine[600], dark: pine[400] };
const PAID: Swatch = { key: 'paid', label: 'Has entry fee', light: sand[600], dark: sand[400] };
const ACCESSIBLE: Swatch = { key: 'accessible', label: 'Accessible camping', light: '#2C7A93', dark: '#5FAEC6' };
const NOT_REPORTED: Swatch = { key: 'not', label: 'Not reported', light: sand[600], dark: sand[400] };

// Dark-sky: indigo (dark skies) → pale yellow (light pollution). Bucketed by Bortle threshold (atLeast).
const DARKSKY_BUCKETS: { atLeast: number; swatch: Swatch }[] = [
  { atLeast: 1, swatch: { key: 'excellent', label: 'Excellent (Bortle 1–2)', light: '#2D2A6E', dark: '#6E68C4' } },
  { atLeast: 3, swatch: { key: 'dark', label: 'Dark (3–4)', light: '#5B5BA6', dark: '#8E89D6' } },
  { atLeast: 5, swatch: { key: 'suburban', label: 'Suburban (5–6)', light: '#9E87A6', dark: '#B7A0C0' } },
  { atLeast: 7, swatch: { key: 'bright', label: 'Bright (7–9)', light: '#D9B86B', dark: '#E8CC85' } },
];

// Crowds: green (quiet) → red (packed), keyed on the crowdLevel enum written by lib/datasources/visitation.
const CROWD_BUCKETS: { value: string; swatch: Swatch }[] = [
  { value: 'low', swatch: { key: 'low', label: 'Low', light: pine[600], dark: pine[400] } },
  { value: 'moderate', swatch: { key: 'moderate', label: 'Moderate', light: '#C4922E', dark: '#E0B64A' } },
  { value: 'high', swatch: { key: 'high', label: 'High', light: '#D9772E', dark: '#EC9450' } },
  { value: 'very high', swatch: { key: 'veryhigh', label: 'Very high', light: '#C84030', dark: '#E66552' } },
];

/**
 * MapLibre `circle-color` expression for a lens, or `null` for 'none' (caller keeps the designation color).
 * Returned as `unknown[]` so this module stays free of maplibre-gl types; the map casts it.
 */
export function lensColorExpr(key: LensKey, mode: ColorMode | undefined): unknown[] | null {
  switch (key) {
    case 'darksky':
      // bortleScale baked as `?? -1`, so input < 1 hits the step base = No data.
      return ['step', ['get', 'bortleScale'], pick(NO_DATA, mode),
        ...DARKSKY_BUCKETS.flatMap((b) => [b.atLeast, pick(b.swatch, mode)])];
    case 'crowd':
      return ['match', ['get', 'crowdLevel'],
        ...CROWD_BUCKETS.flatMap((b) => [b.value, pick(b.swatch, mode)]), pick(NO_DATA, mode)];
    case 'fee':
      return ['case', ['get', 'feeFree'], pick(FREE, mode), pick(PAID, mode)];
    case 'accessibility':
      return ['case', ['get', 'accessible'], pick(ACCESSIBLE, mode), pick(NOT_REPORTED, mode)];
    default:
      return null;
  }
}

/** Legend swatches for a lens (empty for 'none' — the panel shows the designation legend instead). */
export function lensLegend(key: LensKey, mode: ColorMode | undefined): LensLegendEntry[] {
  const entry = (s: Swatch): LensLegendEntry => ({ key: s.key, label: s.label, color: pick(s, mode) });
  switch (key) {
    case 'darksky':
      return [...DARKSKY_BUCKETS.map((b) => entry(b.swatch)), entry(NO_DATA)];
    case 'crowd':
      return [...CROWD_BUCKETS.map((b) => entry(b.swatch)), entry(NO_DATA)];
    case 'fee':
      return [entry(FREE), entry(PAID)];
    case 'accessibility':
      return [entry(ACCESSIBLE), entry(NOT_REPORTED)];
    default:
      return [];
  }
}

export const lensLabel = (key: LensKey): string => MAP_LENSES.find((l) => l.key === key)?.label ?? 'Designation';
