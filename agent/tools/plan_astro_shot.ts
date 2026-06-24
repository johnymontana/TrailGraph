import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { getAstro, sqmFromBortle, shotPlan } from '../../lib/datasources';

/**
 * Milky-Way shot planner (ADR-055) — the astrophotographer's tool. Given a park and a foreground compass
 * bearing, computes when (during astronomical darkness) the galactic core lines up over that foreground,
 * the core's altitude then, and moon-wash advice. Deterministic ephemeris (no API, no fabrication).
 * Graph-grounded (R6): coordinates come from the graph, never the model. Renders into the astro_card's
 * "Shot" tab alongside tonight's sky.
 */
export default defineTool({
  description:
    'Plan a Milky-Way astrophotography shot at a park: when the galactic core lines up over a chosen ' +
    'foreground, with moon-wash advice. parkCode + foregroundAzimuthDeg (compass bearing, 0=N 90=E ' +
    '180=S 270=W) required; optional date YYYY-MM-DD. Use after the user describes a foreground/direction.',
  inputSchema: z.object({
    parkCode: z.string(),
    foregroundAzimuthDeg: z.number().describe('Compass bearing of the foreground subject, 0–360° (0=N, 90=E, 180=S, 270=W).'),
    date: z.string().optional(),
  }),
  async execute({ parkCode, foregroundAzimuthDeg, date }) {
    const park = await parkDetail(parkCode);
    if (!park || park.lat == null || park.lng == null) {
      return { kind: 'astro_card', data: { error: `No coordinates for ${parkCode}` } };
    }
    const lat = park.lat as number;
    const lng = park.lng as number;
    const bortle = (park.bortleScale as number | null) ?? null;
    return {
      kind: 'astro_card',
      data: {
        park: park.name,
        parkCode,
        bortle,
        sqm: bortle != null ? sqmFromBortle(bortle) : null,
        ...getAstro(lat, lng, date),
        shot: shotPlan(lat, lng, foregroundAzimuthDeg, date),
      },
    };
  },
});
