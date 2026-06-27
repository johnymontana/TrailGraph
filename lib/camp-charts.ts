/**
 * Pure data shapers for the campground comparison scorecard (Campgrounds feature, Phase 3 viz). Server-safe
 * + deterministic + unit-tested, mirroring lib/park-charts.ts. The radar compares 2–4 campgrounds across a
 * fixed set of 0–100 axes derived from the structured inventory (no live availability needed). The
 * booking-ease axis is **null-safe**: when booking difficulty is unknown it's greyed (NaN), not scored 100.
 */

export interface CampScoreInput {
  totalSites?: number | null;
  feeUSD?: number | null;
  free?: boolean;
  hasHookups?: boolean;
  maxAmps?: number | null;
  ada?: boolean;
  cellReception?: boolean;
  darkSky?: boolean;
  amenityCount?: number;
  booksOutDays?: number | null; // higher = harder to get
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** The 0–100 axes for one campground. Booking-ease is NaN when difficulty is unknown (greyed, not 100). */
export function campgroundScores(c: CampScoreInput): Record<string, number> {
  const hookups = c.maxAmps ? (c.maxAmps >= 50 ? 100 : c.maxAmps >= 30 ? 70 : 40) : c.hasHookups ? 50 : 0;
  const affordability = c.free ? 100 : c.feeUSD != null ? clamp(100 - c.feeUSD * 1.5) : 50; // $0→100, ~$66→0
  return {
    Amenities: clamp((c.amenityCount ?? 0) * 15),
    Affordability: affordability,
    Hookups: hookups,
    Accessibility: c.ada ? 100 : 0,
    Size: clamp((c.totalSites ?? 0) / 3), // ~300 sites → 100
    Connectivity: c.cellReception ? 100 : 0,
    'Dark sky': c.darkSky ? 100 : 30,
    // Books out N days → ease = 100 at 0 days, 0 at ~180 days. Unknown → NaN (recharts greys it).
    'Booking ease': c.booksOutDays != null ? clamp(100 - (c.booksOutDays / 180) * 100) : NaN,
  };
}

export const COMPARE_AXES = ['Amenities', 'Affordability', 'Hookups', 'Accessibility', 'Size', 'Connectivity', 'Dark sky', 'Booking ease'];

export interface CompareDatum {
  axis: string;
  [campgroundKey: string]: string | number;
}

/** Pivot per-campground scores into the recharts multi-series radar shape (one column per campground). */
export function campgroundCompareData(items: { key: string; scores: Record<string, number> }[]): CompareDatum[] {
  return COMPARE_AXES.map((axis) => {
    const row: CompareDatum = { axis };
    for (const it of items) {
      const v = it.scores[axis];
      if (Number.isFinite(v)) row[it.key] = v; // skip NaN so the booking-ease axis greys for unknowns
    }
    return row;
  });
}
