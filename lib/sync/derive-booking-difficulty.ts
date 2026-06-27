import { writeGraph } from '../neo4j';

/**
 * Booking-difficulty intelligence (Campgrounds feature, Phase 2; gated `DERIVE_BOOKING_DIFFICULTY=1`).
 * The input is the RIDB **historical reservation download** (a bulk CSV from ridb.recreation.gov/download,
 * NOT the API) — operator data, so this reads a file rather than fetching. Per facility it derives:
 *   booksOutDays     = median(startdate − orderdate)  → "books out ~N days ahead"
 *   weekendFillRate  = share of Fri/Sat reserved nights
 * and SETs them on `:Campground` joined by `ridbId = facilityid`. Surfaced by campgroundDetail + the
 * "Hard-to-get" rail. No file configured → no-op `{skipped:1}` (the gated/scaffolded posture). The pure
 * aggregator (`computeBookingStats`) is unit-tested.
 */

export interface ReservationRow {
  facilityId: string;
  orderDate: string; // YYYY-MM-DD
  startDate: string; // YYYY-MM-DD
  nights: number;
}

export interface FacilityBookingStats {
  facilityId: string;
  booksOutDays: number | null;
  weekendFillRate: number | null;
  reservations: number;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const dayDiff = (a: string, b: string): number | null => {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
};

const isWeekendStart = (date: string): boolean => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 5 || d === 6; // Fri / Sat
};

/** Aggregate raw reservation rows → per-facility booking stats. Pure (unit-tested). */
export function computeBookingStats(rows: ReservationRow[]): FacilityBookingStats[] {
  const byFacility = new Map<string, { leads: number[]; total: number; weekend: number }>();
  for (const r of rows) {
    if (!r.facilityId) continue;
    const e = byFacility.get(r.facilityId) ?? { leads: [], total: 0, weekend: 0 };
    const lead = dayDiff(r.orderDate, r.startDate);
    if (lead != null && lead >= 0) e.leads.push(lead);
    e.total += 1;
    if (isWeekendStart(r.startDate)) e.weekend += 1;
    byFacility.set(r.facilityId, e);
  }
  return [...byFacility.entries()].map(([facilityId, e]) => ({
    facilityId,
    booksOutDays: median(e.leads),
    weekendFillRate: e.total ? Math.round((e.weekend / e.total) * 100) / 100 : null,
    reservations: e.total,
  }));
}

/** Minimal CSV parse (no dependency): header row → {facilityid, orderdate, startdate, nights} columns. */
export function parseReservationCsv(text: string): ReservationRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const fi = idx('facilityid');
  const oi = idx('orderdate');
  const si = idx('startdate');
  const ni = idx('nights');
  if (fi < 0 || oi < 0 || si < 0) return [];
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return {
      facilityId: (cols[fi] ?? '').trim(),
      orderDate: (cols[oi] ?? '').trim().slice(0, 10),
      startDate: (cols[si] ?? '').trim().slice(0, 10),
      nights: ni >= 0 ? Number(cols[ni]) || 1 : 1,
    };
  });
}

export async function deriveBookingDifficulty(): Promise<{ facilities: number; updated: number; skipped?: number }> {
  const path = process.env.RIDB_HISTORICAL_PATH;
  if (!path) return { facilities: 0, updated: 0, skipped: 1 };
  let text: string;
  try {
    const { readFile } = await import('node:fs/promises');
    text = await readFile(path, 'utf8');
  } catch {
    return { facilities: 0, updated: 0, skipped: 1 };
  }
  const stats = computeBookingStats(parseReservationCsv(text));
  if (!stats.length) return { facilities: 0, updated: 0, skipped: 1 };
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MATCH (c:Campground {ridbId: row.facilityId})
     SET c.booksOutDays = row.booksOutDays, c.weekendFillRate = row.weekendFillRate
     RETURN count(c) AS c`,
    { rows: stats },
  );
  return { facilities: stats.length, updated: r[0]?.c ?? 0 };
}
