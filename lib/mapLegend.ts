/**
 * Map legibility model (#2): classify a park's free-form NPS `designation` into a small set of buckets,
 * and give each bucket — plus each POI layer — a distinct color + icon + label so the map and its legend
 * are unambiguous (fixing the old all-pine parks/campgrounds and orange visitor-centers/things-to-do
 * collisions). These are CANVAS colors (MapLibre paint can't read CSS tokens), so — like `lib/brandColors`
 * — they're resolved to light/dark hex here, derived from the brand scales where it fits and a few extra
 * categorical hues kept earthy to match the "Topographic Adventure" palette. Pure + unit-tested.
 */
import type { ColorMode } from '../components/ui/color-mode';
import { pine, trail, sand } from '../theme/colors';

export type DesignationKey = 'park' | 'monument' | 'historic' | 'seashore' | 'preserve' | 'recreation' | 'other';

interface CategoryDef {
  label: string;
  /** Icon key (drawn by lib/mapMarkers.ts). */
  icon: string;
  light: string;
  dark: string;
}

const DESIGNATIONS: Record<DesignationKey, CategoryDef> = {
  park: { label: 'National Park', icon: 'mountain', light: pine[600], dark: pine[400] },
  monument: { label: 'Monument / Memorial', icon: 'monument', light: trail[600], dark: trail[400] },
  historic: { label: 'Historic / Battlefield', icon: 'landmark', light: '#5B4FA8', dark: '#9384DA' },
  seashore: { label: 'Seashore / River', icon: 'wave', light: '#2C7A93', dark: '#5FAEC6' },
  preserve: { label: 'Preserve', icon: 'leaf', light: '#5E8C3E', dark: '#8FBE63' },
  recreation: { label: 'Recreation / Parkway', icon: 'binoculars', light: '#C4922E', dark: '#E2B84C' },
  other: { label: 'Other site', icon: 'pin', light: sand[600], dark: sand[400] },
};

/** Display order for the legend (flagship first, catch-all last). */
export const DESIGNATION_ORDER: DesignationKey[] = ['park', 'monument', 'historic', 'seashore', 'preserve', 'recreation', 'other'];

/**
 * Ordered, case-insensitive substring rules — MOST SPECIFIC FIRST. `historic` precedes `park` so
 * "National Historical Park" and "National Military Park" bucket as historic, while `park` precedes
 * `preserve` so "Denali National Park & Preserve" stays a park. Anything unmatched → `other`.
 */
const RULES: { key: DesignationKey; test: RegExp }[] = [
  { key: 'historic', test: /historic|historical|battlefield|military|heritage/i },
  { key: 'seashore', test: /seashore|lakeshore|riverway|scenic river|wild and scenic|national river/i },
  { key: 'park', test: /national park/i },
  { key: 'monument', test: /monument|memorial/i },
  { key: 'preserve', test: /preserve|reserve/i },
  { key: 'recreation', test: /recreation|parkway|scenic trail|national.*trail/i },
];

export function designationKey(designation: string | null | undefined): DesignationKey {
  const d = designation ?? '';
  for (const r of RULES) if (r.test.test(d)) return r.key;
  return 'other';
}

export function designationColor(key: DesignationKey, mode: ColorMode | undefined): string {
  const def = DESIGNATIONS[key];
  return mode === 'dark' ? def.dark : def.light;
}
export const designationLabel = (key: DesignationKey): string => DESIGNATIONS[key].label;
export const designationIcon = (key: DesignationKey): string => DESIGNATIONS[key].icon;

export interface LegendEntry {
  key: string;
  label: string;
  color: string;
  icon: string;
}

export function designationLegend(mode: ColorMode | undefined): LegendEntry[] {
  return DESIGNATION_ORDER.map((key) => ({ key, label: DESIGNATIONS[key].label, color: designationColor(key, mode), icon: DESIGNATIONS[key].icon }));
}

// ── POI layers ────────────────────────────────────────────────────────────────────────────────────
export type PoiKey = 'campgrounds' | 'visitorcenters' | 'thingstodo' | 'alerts' | 'trails';

const POIS: Record<PoiKey, CategoryDef> = {
  campgrounds: { label: 'Campgrounds', icon: 'tent', light: '#8A5A2B', dark: '#BE8A52' },
  visitorcenters: { label: 'Visitor centers', icon: 'info', light: '#3E6DA8', dark: '#79A6DC' },
  thingstodo: { label: 'Things to do', icon: 'star', light: '#8A5FB0', dark: '#B58FDB' },
  alerts: { label: 'Active alerts', icon: 'alert', light: '#E03131', dark: '#FF6B6B' },
  // Real hiking trailheads (ADR-066) — a distinct trail-green, drawn with the footprints glyph.
  trails: { label: 'Trailheads', icon: 'footprints', light: '#2F9E44', dark: '#51CF66' },
};

export const POI_ORDER: PoiKey[] = ['campgrounds', 'visitorcenters', 'thingstodo', 'alerts', 'trails'];

export function poiColor(key: PoiKey, mode: ColorMode | undefined): string {
  const def = POIS[key];
  return mode === 'dark' ? def.dark : def.light;
}
export const poiLabel = (key: PoiKey): string => POIS[key].label;
export const poiIcon = (key: PoiKey): string => POIS[key].icon;

export function poiLegend(mode: ColorMode | undefined): LegendEntry[] {
  return POI_ORDER.map((key) => ({ key, label: POIS[key].label, color: poiColor(key, mode), icon: POIS[key].icon }));
}

/**
 * Flattened [value, output, …, default] stops for a MapLibre `['match', ['get','desigKey'], …]` paint
 * expression. Kept as plain data here (no maplibre-gl import) so the module stays pure/testable; the map
 * component assembles the actual expression. `defaultColor` doubles as the final fallback.
 */
export function designationMatchStops(mode: ColorMode | undefined): (string)[] {
  const stops: string[] = [];
  for (const key of DESIGNATION_ORDER) {
    if (key === 'other') continue; // 'other' is the match default
    stops.push(key, designationColor(key, mode));
  }
  return stops;
}
export const designationDefaultColor = (mode: ColorMode | undefined): string => designationColor('other', mode);
