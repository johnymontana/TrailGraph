import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { getAstro, sqmFromBortle } from '../../lib/datasources';

/**
 * Tonight's astronomy for a park (§5.4 / ADR-043): moon phase + illumination, sun + twilight times,
 * "dark hours", and the Milky-Way galactic-core rise/set + azimuth. All values are computed in-house
 * from the park's coordinates (deterministic ephemeris — no API, no fabrication). Graph-grounded (R6):
 * coordinates come from the graph, never the model. SQM is a clearly-labeled Bortle-derived estimate.
 */
export default defineTool({
  description:
    'Tonight\'s sky for a park by parkCode (optional date YYYY-MM-DD): moon phase/illumination, sun + ' +
    'twilight times, dark hours, and Milky-Way galactic-core rise/set — for stargazing/astrophotography.',
  inputSchema: z.object({ parkCode: z.string(), date: z.string().optional() }),
  async execute({ parkCode, date }) {
    const park = await parkDetail(parkCode);
    if (!park || park.lat == null || park.lng == null) {
      return { kind: 'astro_card', data: { error: `No coordinates for ${parkCode}` } };
    }
    const bortle = (park.bortleScale as number | null) ?? null;
    return {
      kind: 'astro_card',
      data: {
        park: park.name,
        parkCode,
        bortle,
        sqm: bortle != null ? sqmFromBortle(bortle) : null,
        ...getAstro(park.lat as number, park.lng as number, date),
      },
    };
  },
});
