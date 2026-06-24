import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { monthNames, darkSkyRating, sqmFromBortle, getAstro, darkestNight } from '../../lib/datasources';

/**
 * Structured conditions for a park (§5b/§5a): quietest-by-crowds months, typical crowd level, and
 * dark-sky rating — so the ranger cites real data instead of vague prose. Renders as the Dark-Sky
 * Scorecard (ADR-042): a real `dark_sky_card`, not a dropped `map_snippet`. Numbers are computed
 * server-side (rating, SQM estimate, moon/dark-hours), never by the model. Graph-grounded (R6).
 *
 * Moon/dark-hours default to *tonight*; when a trip date window is passed (`startDate`/`endDate`) the
 * card reflects the **best night in that window** (darkest moon) instead — moon phase is the headline
 * number for a stargazing trip and tonight's is wrong for a trip months out (R5 §2.3).
 */
export default defineTool({
  description:
    "Best time to visit a park (quietest-by-crowds months), its typical crowd level, and dark-sky quality, by parkCode. For a dated stargazing trip, pass startDate/endDate (YYYY-MM-DD) so the moon/dark-hours reflect the best night in that window, not tonight.",
  inputSchema: z.object({
    parkCode: z.string(),
    startDate: z.string().optional().describe("Trip window start, YYYY-MM-DD — moon shown for the best night in the window"),
    endDate: z.string().optional().describe("Trip window end, YYYY-MM-DD (defaults to startDate if omitted)"),
  }),
  async execute({ parkCode, startDate, endDate }) {
    const park = await parkDetail(parkCode);
    if (!park) return { kind: 'dark_sky_card', data: { error: `No park with code ${parkCode}` } };
    const bortle = (park.bortleScale as number | null) ?? null;
    const hasCoords = park.lat != null && park.lng != null;
    const lat = park.lat as number;
    const lng = park.lng as number;
    // When the trip has dates, surface the BEST (darkest) night in the window; else tonight (R5 §2.3).
    const best = hasCoords && startDate ? darkestNight(lat, lng, startDate, endDate ?? startDate) : null;
    const astro = best ? best.astro : hasCoords ? getAstro(lat, lng) : null;
    return {
      kind: 'dark_sky_card',
      data: {
        park: park.name,
        parkCode,
        bestMonths: monthNames((park.bestMonths as number[]) ?? []) || null,
        crowdLevel: park.crowdLevel ?? null,
        darkSkyCertified: park.darkSkyCertified ?? false,
        bortleScale: bortle,
        rating: bortle != null ? darkSkyRating(bortle) : null,
        sqmEstimate: bortle != null ? sqmFromBortle(bortle).sqm : null,
        astro: astro
          ? {
              moonIllumination: astro.moon.illuminationPct,
              moonPhase: astro.moon.phaseName,
              moonEmoji: astro.moon.emoji,
              darkHours: astro.darkHours.hours,
            }
          : null,
        // Tell the card which night these astro numbers describe so it can label them honestly.
        astroContext: best ? 'best-night' : 'tonight',
        astroDate: best ? best.date : null,
        astroWindow: best ? { start: startDate, end: endDate ?? startDate } : null,
      },
    };
  },
});
