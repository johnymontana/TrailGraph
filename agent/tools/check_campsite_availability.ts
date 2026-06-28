import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { campgroundDetail, bookingUrlFor } from '../../lib/campgrounds';
import { getCampgroundAvailability, enumerateNights } from '../../lib/datasources/campAvailability';
import { recreationUrl } from '../../lib/datasources/recreation';
import { env } from '../../lib/env';
import { callerId } from '../../lib/agent-ctx';

/**
 * On-demand campsite availability for one campground over a date range (Campgrounds feature). Hits the
 * recreation.gov month endpoint, which is UNOFFICIAL — so this DEGRADES to a recreation.gov deep link
 * whenever live availability is disabled or unreachable. Never authoritative, never books. userId-bound (R4).
 */
export default defineTool({
  description:
    "Check what's open at ONE campground for specific dates. Give either campgroundId (from a card) or ridbId, plus startDate/endDate (YYYY-MM-DD). Returns per-night open counts when live availability is enabled, otherwise a recreation.gov deep link to check there. Best-effort, not authoritative — always tell the user to verify before booking. Never books or holds a site.",
  inputSchema: z.object({
    campgroundId: z.string().optional(),
    ridbId: z.string().optional(),
    startDate: z.string().describe('First night, YYYY-MM-DD'),
    endDate: z.string().describe('Last night, YYYY-MM-DD'),
  }),
  async execute({ campgroundId, ridbId, startDate, endDate }, ctx) {
    callerId(ctx); // server-bound identity (read-only tool, but keep the auth gate consistent)

    let name = 'this campground';
    let resolvedRidb = ridbId ?? null;
    let bookingUrl: string | null = ridbId ? recreationUrl(ridbId) : null;
    if (campgroundId) {
      const cg = await campgroundDetail(campgroundId);
      if (!cg) return { kind: 'availability_card', data: { error: `No campground found for id "${campgroundId}".` } };
      name = cg.name;
      resolvedRidb = cg.ridbId ?? ridbId ?? null;
      bookingUrl = bookingUrlFor(cg);
    }

    if (!resolvedRidb || !env.camp.availabilityEnabled) {
      return { kind: 'availability_card', data: { name, ridbId: resolvedRidb, degraded: true, bookingUrl, nights: [] } };
    }

    const nights = enumerateNights(startDate, endDate);
    const months = [...new Set(nights.map((d) => d.slice(0, 7)))];
    const data = await Promise.all(months.map((m) => getCampgroundAvailability(resolvedRidb!, `${m}-01`)));
    if (data.every((m) => m === null)) {
      return { kind: 'availability_card', data: { name, ridbId: resolvedRidb, degraded: true, bookingUrl, nights: [] } };
    }
    const byDate = new Map<string, { sitesOpen: number; byType: Record<string, number> }>();
    for (const m of data) for (const dd of m?.days ?? []) byDate.set(dd.date, { sitesOpen: dd.sitesOpen, byType: dd.byType });
    const out = nights.map((date) => ({ date, sitesOpen: byDate.get(date)?.sitesOpen ?? 0, byType: byDate.get(date)?.byType ?? {} }));
    return {
      kind: 'availability_card',
      data: { name, ridbId: resolvedRidb, degraded: false, bookingUrl, nights: out, anyOpen: out.some((n) => n.sitesOpen > 0) },
    };
  },
});
