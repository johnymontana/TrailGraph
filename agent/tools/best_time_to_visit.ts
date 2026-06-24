import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { monthNames, darkSkyRating, sqmFromBortle, getAstro } from '../../lib/datasources';

/**
 * Structured conditions for a park (§5b/§5a): lowest-crowd months, typical crowd level, and dark-sky
 * rating — so the ranger cites real data instead of vague prose. Renders as the Dark-Sky Scorecard
 * (ADR-042): a real `dark_sky_card`, not a dropped `map_snippet`. Numbers are computed server-side
 * (rating, SQM estimate, moon/dark-hours), never by the model. Graph-grounded (R6).
 */
export default defineTool({
  description:
    "Best time to visit a park (lowest-crowd months), its typical crowd level, and dark-sky quality, by parkCode.",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }) {
    const park = await parkDetail(parkCode);
    if (!park) return { kind: 'dark_sky_card', data: { error: `No park with code ${parkCode}` } };
    const bortle = (park.bortleScale as number | null) ?? null;
    const astro = park.lat != null && park.lng != null ? getAstro(park.lat as number, park.lng as number) : null;
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
      },
    };
  },
});
