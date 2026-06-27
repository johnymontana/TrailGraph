import { env } from '../env';

/**
 * Live recreation.gov campsite availability (Campgrounds feature, Phase 2). The month endpoint
 * (`/api/camps/availability/campground/<ridbId>/month`) is rec.gov's **unofficial/undocumented internal
 * API** — so this whole adapter is a best-effort overlay, NEVER authoritative:
 *
 *  - Hard kill-switch: every call returns null unless `CAMP_AVAILABILITY_ENABLED=1` (`env.camp...`). Shipped
 *    OFF; with it off every surface degrades to a recreation.gov deep link.
 *  - Respectful: aggressive `next.revalidate` cache, module-level exponential backoff (60s→30min) on
 *    429/5xx with an automatic skip while cooling, a clear identifying User-Agent, swallow-to-null on any
 *    error (never throw into a tool/route/cron).
 *  - Bounded: callers only ever poll viewed / watched / curated campgrounds (never crawl all federal).
 *
 * Mirrors the conditions.ts / weather.ts runtime-fetch pattern. Pure helpers (mapStatus / enumerateNights /
 * countOpenNights) are unit-tested.
 */

export type SiteStatus = 'open' | 'reserved' | 'closed' | 'unknown';

export interface CampDay {
  date: string; // YYYY-MM-DD
  sitesOpen: number;
  byType: Record<string, number>; // campsite_type → open count
}

export interface CampMonthAvailability {
  ridbId: string;
  monthStart: string; // YYYY-MM-DD (first of month)
  days: CampDay[]; // only dates with ≥1 open site
  perSite: Record<string, Record<string, SiteStatus>>; // siteId → date → status (for the watch diff)
  siteType: Record<string, string>; // siteId → campsite_type
  fetchedAt: string;
}

// ---- pure helpers (unit-tested) ----------------------------------------------------------------

/** rec.gov availability label → our coarse status. Pure. */
export function mapStatus(raw: string): SiteStatus {
  const s = (raw || '').toLowerCase();
  if (s.includes('available') && !s.includes('not available')) return 'open';
  if (s.includes('reserved')) return 'reserved';
  if (s.includes('not reservable') || s.includes('not available') || s.includes('closed') || s === 'nyr') return 'closed';
  return 'unknown';
}

/** Each night YYYY-MM-DD from start through end INCLUSIVE. Pure. Returns [] on bad input. */
export function enumerateNights(start: string, end: string): string[] {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out: string[] = [];
  for (let t = a; t <= b; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out.slice(0, 60); // hard cap (a watch window is days/weeks, never years)
}

/**
 * Count how many of `nights` have ≥1 open site, optionally constrained to a `siteType` and to consecutive
 * runs of ≥ `minNights`. Pure. `months` are the per-month results covering those nights (null entries are
 * skipped). Returns the open-night count + the distinct open-site sample size.
 */
export function countOpenNights(
  months: (CampMonthAvailability | null)[],
  nights: string[],
  opts: { siteType?: string; minNights?: number } = {},
): { nightsOpen: number; sampleSiteCount: number } {
  const byDate = new Map<string, CampDay>();
  for (const m of months) for (const d of m?.days ?? []) byDate.set(d.date, d);

  const openFlags = nights.map((n) => {
    const d = byDate.get(n);
    if (!d) return false;
    if (opts.siteType && opts.siteType !== 'any') return (d.byType[opts.siteType] ?? 0) > 0;
    return d.sitesOpen > 0;
  });

  // Apply the minNights consecutive constraint: only nights inside a run ≥ minNights count.
  const min = opts.minNights && opts.minNights > 1 ? opts.minNights : 1;
  let nightsOpen = 0;
  let run = 0;
  for (let i = 0; i <= openFlags.length; i++) {
    if (i < openFlags.length && openFlags[i]) {
      run++;
    } else {
      if (run >= min) nightsOpen += run;
      run = 0;
    }
  }

  // Distinct open sites across the requested nights (a "how many" sample for the card).
  const sites = new Set<string>();
  const nightSet = new Set(nights);
  for (const m of months) {
    for (const [siteId, byDay] of Object.entries(m?.perSite ?? {})) {
      for (const [date, st] of Object.entries(byDay)) {
        if (st === 'open' && nightSet.has(date)) {
          if (opts.siteType && opts.siteType !== 'any' && m && m.siteType[siteId] !== opts.siteType) continue;
          sites.add(siteId);
        }
      }
    }
  }
  return { nightsOpen, sampleSiteCount: sites.size };
}

// ---- live fetch (gated, backoff-aware) ---------------------------------------------------------

let cooldownUntil = 0;
let backoffMs = 60_000;
const MAX_BACKOFF = 30 * 60_000;

interface RecApiSite {
  availabilities?: Record<string, string>;
  campsite_type?: string;
}
interface RecApiResponse {
  campsites?: Record<string, RecApiSite>;
}

/**
 * Fetch one month of per-site availability for a RIDB facility. `monthStart` is any date in the target
 * month (we normalize to the 1st). Returns null when disabled, cooling down, or on any error/parse failure.
 */
export async function getCampgroundAvailability(
  ridbId: string,
  monthStart: string,
): Promise<CampMonthAvailability | null> {
  if (!env.camp.availabilityEnabled) return null; // kill-switch → caller degrades to the deep link
  if (Date.now() < cooldownUntil) return null; // backoff window

  const monthFirst = `${monthStart.slice(0, 7)}-01`;
  const url = `https://www.recreation.gov/api/camps/availability/campground/${encodeURIComponent(
    ridbId,
  )}/month?start_date=${encodeURIComponent(`${monthFirst}T00:00:00.000Z`)}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': env.camp.userAgent, Accept: 'application/json' },
      next: { revalidate: 900 }, // ~15-min cache
    });
    if (res.status === 429 || res.status >= 500) {
      cooldownUntil = Date.now() + backoffMs;
      backoffMs = Math.min(MAX_BACKOFF, backoffMs * 2);
      return null;
    }
    if (!res.ok) return null;
    backoffMs = 60_000; // reset on success

    const json = (await res.json()) as RecApiResponse;
    const perSite: CampMonthAvailability['perSite'] = {};
    const siteType: CampMonthAvailability['siteType'] = {};
    const dayOpen: Record<string, number> = {};
    const dayType: Record<string, Record<string, number>> = {};

    for (const [siteId, site] of Object.entries(json.campsites ?? {})) {
      const type = (site.campsite_type ?? 'site').toLowerCase();
      siteType[siteId] = type;
      perSite[siteId] = {};
      for (const [iso, raw] of Object.entries(site.availabilities ?? {})) {
        const date = iso.slice(0, 10);
        const st = mapStatus(raw);
        perSite[siteId][date] = st;
        if (st === 'open') {
          dayOpen[date] = (dayOpen[date] ?? 0) + 1;
          (dayType[date] ??= {})[type] = ((dayType[date] ?? {})[type] ?? 0) + 1;
        }
      }
    }
    const days: CampDay[] = Object.keys(dayOpen)
      .sort()
      .map((date) => ({ date, sitesOpen: dayOpen[date], byType: dayType[date] ?? {} }));
    return { ridbId, monthStart: monthFirst, days, perSite, siteType, fetchedAt: new Date().toISOString() };
  } catch {
    return null; // never throw into a tool/route/cron
  }
}
