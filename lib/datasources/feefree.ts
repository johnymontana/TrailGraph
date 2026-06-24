import { writeGraph } from '../neo4j';

/**
 * Fee-free days (§5-style curated seed, plan F2) — behind the AD-3 adapter pattern, like `darksky.ts`.
 * The NPS API does NOT expose the ~6 annual entrance-fee-free days, so we curate them as `(:FeeFreeDay
 * {date,name})` nodes. These apply to ALL fee-charging parks. CURATION NOTE: the list is published yearly
 * by NPS and MUST be refreshed each year (these are the 2026 dates). Render with an "as published by NPS"
 * caveat. Swap this seed for a live fetch if NPS ever exposes the dates.
 */
export interface FeeFreeDay {
  date: string; // ISO YYYY-MM-DD
  name: string;
}

export const FEE_FREE_DAYS: FeeFreeDay[] = [
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-04-18', name: 'First Day of National Park Week' },
  { date: '2026-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2026-08-04', name: 'Anniversary of the Great American Outdoors Act' },
  { date: '2026-09-26', name: 'National Public Lands Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
];

/** Upsert the curated fee-free days as `(:FeeFreeDay {date})`. Idempotent. Returns the count applied. */
export async function applyFeeFreeDays(days: FeeFreeDay[] = FEE_FREE_DAYS): Promise<number> {
  if (!days.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `UNWIND $days AS d
     MERGE (f:FeeFreeDay {date: date(d.date)})
       SET f.name = d.name
     RETURN count(f) AS c`,
    { days },
  );
  return r[0]?.c ?? 0;
}

/** Is an ISO date one of the curated fee-free days? Pure (unit-tested). */
export function isFeeFreeDay(isoDate: string, days: FeeFreeDay[] = FEE_FREE_DAYS): FeeFreeDay | null {
  return days.find((d) => d.date === isoDate) ?? null;
}
