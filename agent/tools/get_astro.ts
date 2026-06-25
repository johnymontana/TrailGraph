import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { getAstro, sqmFromBortle, meteorShowers, satellitePasses, fetchVisibleSatellites, darkestNight } from '../../lib/datasources';

/**
 * Tonight's astronomy for a park (§5.4 / ADR-043, extended in ADR-055): moon phase + illumination, sun +
 * twilight times, "dark hours", the Milky-Way galactic-core rise/set + azimuth, AND the Astro Command
 * Center extras — meteor showers active that night and naked-eye-visible satellite (ISS) passes. All
 * computed in-house from the park's coordinates (deterministic ephemeris + SGP4) — no fabrication. TLEs
 * are fetched best-effort from CelesTrak; if that fails, passes are simply omitted (never faked).
 * Graph-grounded (R6): coordinates come from the graph, never the model.
 */
export default defineTool({
  description:
    'Sky for a park by parkCode: moon phase/illumination, sun + twilight times, dark hours, Milky-Way ' +
    'galactic-core rise/set, active meteor showers, and visible ISS/satellite passes — for ' +
    'stargazing/astrophotography. Defaults to tonight; pass a single `date`, or `startDate`/`endDate` for a ' +
    'trip window so the numbers reflect the best (darkest) night in it, not tonight. Use plan_astro_shot to align the core over a foreground.',
  inputSchema: z.object({
    parkCode: z.string(),
    date: z.string().optional(),
    startDate: z.string().optional().describe('Trip window start, YYYY-MM-DD — picks the best (darkest) night in the window instead of tonight'),
    endDate: z.string().optional().describe('Trip window end, YYYY-MM-DD (defaults to startDate if omitted)'),
  }),
  async execute({ parkCode, date, startDate, endDate }) {
    const park = await parkDetail(parkCode);
    if (!park || park.lat == null || park.lng == null) {
      return { kind: 'astro_card', data: { error: `No coordinates for ${parkCode}` } };
    }
    const lat = park.lat as number;
    const lng = park.lng as number;
    const bortle = (park.bortleScale as number | null) ?? null;
    // When the trip has dates, compute the BEST (darkest) night in the window so moon/dark-hours/core are
    // right for a trip months out — not tonight's phase (P2.1). Else fall back to the explicit date / tonight.
    const best = startDate ? darkestNight(lat, lng, startDate, endDate ?? startDate) : null;
    const night = best?.date ?? date;
    // Satellite passes are best-effort: live TLEs from CelesTrak, or omitted on failure (ADR-043 honesty).
    const tles = await fetchVisibleSatellites(8);
    const passes = tles.length ? satellitePasses(lat, lng, tles, night, { visibleOnly: true }).slice(0, 6) : [];
    return {
      kind: 'astro_card',
      data: {
        park: park.name,
        parkCode,
        bortle,
        darkSkyCertified: park.darkSkyCertified ?? false,
        sqm: bortle != null ? sqmFromBortle(bortle) : null,
        ...getAstro(lat, lng, night),
        meteorShowers: meteorShowers(night),
        satellitePasses: passes,
        satellitesAvailable: tles.length > 0,
        // Tell the card which night these numbers describe (P2.1): the best night in the trip window, or tonight.
        astroContext: best ? 'best-night' : 'tonight',
        astroDate: best ? best.date : null,
        astroWindow: best ? { start: startDate, end: endDate ?? startDate } : null,
      },
    };
  },
});
