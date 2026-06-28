/**
 * Campground map lenses (Campgrounds feature, Phase 4): recolor the `poi-campgrounds` POI layer by a camp
 * facet — free, dispersed, hookups, ADA, or first-come — instead of the flat agency-brown. The "Free &
 * dispersed" goal of the feature plan, on the map. Pure, mirroring lib/mapLenses.ts: each lens emits a
 * MapLibre `circle-color` expression over the boolean props stamped on each campground feature in
 * MapExplorer (`free`/`dispersed`/`hasHookups`/`ada`/`fcfs`), plus a matching legend. Canvas hex per color
 * mode (like lib/mapLenses / lib/brandColors). Unit-tested.
 */
import type { ColorMode } from '../components/ui/color-mode';
import { pine, sand, trail } from '../theme/colors';

export type CampLensKey = 'none' | 'free' | 'dispersed' | 'hookups' | 'ada' | 'fcfs';

export const CAMP_LENSES: { key: CampLensKey; label: string }[] = [
  { key: 'none', label: 'Agency' },
  { key: 'free', label: 'Free' },
  { key: 'dispersed', label: 'Dispersed' },
  { key: 'hookups', label: 'Hookups' },
  { key: 'ada', label: 'Accessible' },
  { key: 'fcfs', label: 'First-come' },
];

export interface CampLensLegendEntry {
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

const ON: Record<CampLensKey, Swatch> = {
  none: { key: 'on', label: '', light: pine[600], dark: pine[400] },
  free: { key: 'free', label: 'Free', light: pine[600], dark: pine[400] },
  dispersed: { key: 'dispersed', label: 'Dispersed', light: trail[600], dark: trail[400] },
  hookups: { key: 'hookups', label: 'Has hookups', light: '#2C7A93', dark: '#5FAEC6' },
  ada: { key: 'ada', label: 'Accessible', light: '#5B4FA8', dark: '#9384DA' },
  fcfs: { key: 'fcfs', label: 'First-come', light: '#C4922E', dark: '#E2B84C' },
};
const OFF: Swatch = { key: 'off', label: 'No / not reported', light: sand[600], dark: sand[400] };

const PROP: Record<Exclude<CampLensKey, 'none'>, string> = {
  free: 'free',
  dispersed: 'dispersed',
  hookups: 'hasHookups',
  ada: 'ada',
  fcfs: 'fcfs',
};

/**
 * MapLibre `circle-color` expression for a camp lens, or `null` for 'none' (caller keeps the agency color).
 * Returned as `unknown[]` so this module stays free of maplibre-gl types; the map casts it.
 */
export function campLensColorExpr(key: CampLensKey, mode: ColorMode | undefined): unknown[] | null {
  if (key === 'none') return null;
  return ['case', ['get', PROP[key]], pick(ON[key], mode), pick(OFF, mode)];
}

/** Legend swatches for a camp lens (empty for 'none' — the panel shows the agency legend instead). */
export function campLensLegend(key: CampLensKey, mode: ColorMode | undefined): CampLensLegendEntry[] {
  if (key === 'none') return [];
  const on = ON[key];
  const label = CAMP_LENSES.find((l) => l.key === key)?.label ?? on.label;
  return [
    { key: on.key, label, color: pick(on, mode) },
    { key: OFF.key, label: OFF.label, color: pick(OFF, mode) },
  ];
}

export const campLensLabel = (key: CampLensKey): string => CAMP_LENSES.find((l) => l.key === key)?.label ?? 'Agency';
