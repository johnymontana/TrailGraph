import { writeGraph } from '../neo4j';
import { NPS_VISITATION } from './visitation-data';

/**
 * Visitation / crowd data source (§5b). Real NPS Visitor Use Statistics (monthly recreation visits)
 * behind the AD-3 adapter: `NPS_VISITATION` (lib/datasources/visitation-data.ts) is generated from the
 * public NPS data package by `scripts/build-visitation-dataset.ts` (3-year average per month, ~400
 * parks). Stores the monthly array on `:Park` and derives `bestMonths` (lowest-crowd) + a `crowdLevel`
 * bucket. Pure derivations are unit-tested. The small `VISITATION` constant below is a curated fallback.
 */
export interface VisitationRecord {
  parkCode: string;
  /** 12 monthly recreation-visit counts, Jan…Dec. */
  monthly: number[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Curated fallback shapes (used only if the generated NPS dataset is unavailable).
export const VISITATION: VisitationRecord[] = [
  { parkCode: 'yell', monthly: [30, 35, 50, 110, 380, 760, 980, 920, 600, 250, 45, 30].map((k) => k * 1000) },
  { parkCode: 'glac', monthly: [12, 14, 22, 60, 210, 520, 720, 690, 380, 120, 25, 14].map((k) => k * 1000) },
  { parkCode: 'grca', monthly: [220, 250, 380, 520, 600, 640, 660, 600, 520, 470, 320, 240].map((k) => k * 1000) },
  { parkCode: 'grte', monthly: [40, 45, 70, 120, 320, 560, 720, 700, 470, 200, 60, 45].map((k) => k * 1000) },
  { parkCode: 'zion', monthly: [180, 210, 360, 430, 480, 520, 540, 520, 470, 460, 300, 200].map((k) => k * 1000) },
];

/** Lowest-crowd months (1-indexed) — those at or below `factor`× the monthly average. Pure. */
export function deriveBestMonths(monthly: number[], factor = 0.7, max = 4): number[] {
  if (monthly.length !== 12) return [];
  const avg = monthly.reduce((a, b) => a + b, 0) / 12;
  return monthly
    .map((v, i) => ({ month: i + 1, v }))
    .filter((m) => m.v <= avg * factor)
    .sort((a, b) => a.v - b.v)
    .slice(0, max)
    .map((m) => m.month)
    .sort((a, b) => a - b);
}

/** Crowd level from annual recreation visits. Pure. */
export function crowdLevel(annual: number): 'low' | 'moderate' | 'high' | 'very high' {
  if (annual >= 4_000_000) return 'very high';
  if (annual >= 2_000_000) return 'high';
  if (annual >= 750_000) return 'moderate';
  return 'low';
}

/** Format month numbers (1-indexed) as short names: [1,4,11] → "Jan, Apr, Nov". Pure. */
export function monthNames(months: number[]): string {
  return months.map((m) => MONTHS[m - 1]).filter(Boolean).join(', ');
}

export interface CrowdCurvePoint {
  month: number; // 1-indexed
  label: string; // 'Jan'…'Dec'
  visits: number;
  pct: number; // 0..100 of the busiest month — the normalized "crowd curve"
}

/**
 * Normalize a 12-month visitation array into a 0–100 crowd curve (Collective Intelligence v2, ADR-053).
 * Each month becomes a percentage of the busiest month, so different-sized parks overlay on one axis
 * ("when is each park least crowded?"). Pure (unit-tested). Returns [] unless given 12 months.
 */
export function normalizeCrowdCurve(monthly: number[]): CrowdCurvePoint[] {
  if (monthly.length !== 12) return [];
  const max = Math.max(...monthly, 1);
  return monthly.map((v, i) => ({ month: i + 1, label: MONTHS[i], visits: Math.round(v), pct: Math.round((v / max) * 100) }));
}

export async function applyVisitation(
  records: VisitationRecord[] = NPS_VISITATION.length ? NPS_VISITATION : VISITATION,
): Promise<number> {
  let applied = 0;
  for (const r of records) {
    const annual = r.monthly.reduce((a, b) => a + b, 0);
    const res = await writeGraph<{ code: string }>(
      `MATCH (p:Park {parkCode:$parkCode})
       SET p.monthlyVisits = $monthly, p.annualVisits = toInteger($annual),
           p.bestMonths = $bestMonths, p.crowdLevel = $crowd
       RETURN p.parkCode AS code`,
      {
        parkCode: r.parkCode,
        monthly: r.monthly.map((v) => Math.round(v)),
        annual,
        bestMonths: deriveBestMonths(r.monthly),
        crowd: crowdLevel(annual),
      },
    );
    if (res.length) applied++;
  }
  return applied;
}
