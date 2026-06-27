import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { getCampgroundAvailability, enumerateNights } from '../../../../lib/datasources/campAvailability';
import { searchAvailability } from '../../../../lib/campgrounds';
import { env } from '../../../../lib/env';

/**
 * On-demand campsite availability (Campgrounds feature, Phase 2). Two modes:
 *   ?ridbId=<id>&start=YYYY-MM-DD&end=YYYY-MM-DD   → per-night open counts for one campground
 *   ?parkCode=<code>&start=…&end=…[&siteType&hookups&ada] → "what's open near this park" (graph-filtered)
 *
 * IP-rate-limited (each call does live rec.gov fetches), and ALWAYS degrades to a recreation.gov deep link
 * when CAMP_AVAILABILITY_ENABLED is off / the unofficial endpoint is unreachable. Never authoritative.
 */
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start') ?? '';
  const end = url.searchParams.get('end') ?? '';
  if (!ISO.test(start) || !ISO.test(end)) return Response.json({ error: 'start/end must be YYYY-MM-DD' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'camp-availability'), 30, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  const ridbId = url.searchParams.get('ridbId');
  const parkCode = url.searchParams.get('parkCode');

  if (parkCode) {
    const out = await searchAvailability({
      parkCode,
      startDate: start,
      endDate: end,
      siteType: url.searchParams.get('siteType') ?? undefined,
      hookups: url.searchParams.get('hookups') === '1' || undefined,
      ada: url.searchParams.get('ada') === '1' || undefined,
    });
    return Response.json(out, { headers: { 'Cache-Control': 'private, max-age=300' } });
  }

  if (ridbId) {
    const nights = enumerateNights(start, end);
    const bookingUrl = `https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(ridbId)}`;
    if (!env.camp.availabilityEnabled) {
      return Response.json({ ridbId, degraded: true, bookingUrl, nights: [] });
    }
    const months = [...new Set(nights.map((d) => d.slice(0, 7)))];
    const data = await Promise.all(months.map((m) => getCampgroundAvailability(ridbId, `${m}-01`)));
    if (data.every((m) => m === null)) {
      return Response.json({ ridbId, degraded: true, bookingUrl, nights: [] });
    }
    const byDate = new Map<string, { sitesOpen: number; byType: Record<string, number> }>();
    for (const m of data) for (const d of m?.days ?? []) byDate.set(d.date, { sitesOpen: d.sitesOpen, byType: d.byType });
    const out = nights.map((date) => ({ date, sitesOpen: byDate.get(date)?.sitesOpen ?? 0, byType: byDate.get(date)?.byType ?? {} }));
    return Response.json(
      { ridbId, degraded: false, bookingUrl, nights: out, anyOpen: out.some((n) => n.sitesOpen > 0) },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  }

  return Response.json({ error: 'provide ridbId or parkCode' }, { status: 400 });
}
