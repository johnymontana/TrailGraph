import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { getAstro, sqmFromBortle, meteorShowers, satellitePasses, fetchVisibleSatellites } from '../../lib/datasources';

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
    'Tonight\'s sky for a park by parkCode (optional date YYYY-MM-DD): moon phase/illumination, sun + ' +
    'twilight times, dark hours, Milky-Way galactic-core rise/set, active meteor showers, and visible ' +
    'ISS/satellite passes — for stargazing/astrophotography. Use plan_astro_shot to align the core over a foreground.',
  inputSchema: z.object({ parkCode: z.string(), date: z.string().optional() }),
  async execute({ parkCode, date }) {
    const park = await parkDetail(parkCode);
    if (!park || park.lat == null || park.lng == null) {
      return { kind: 'astro_card', data: { error: `No coordinates for ${parkCode}` } };
    }
    const lat = park.lat as number;
    const lng = park.lng as number;
    const bortle = (park.bortleScale as number | null) ?? null;
    // Satellite passes are best-effort: live TLEs from CelesTrak, or omitted on failure (ADR-043 honesty).
    const tles = await fetchVisibleSatellites(8);
    const passes = tles.length ? satellitePasses(lat, lng, tles, date, { visibleOnly: true }).slice(0, 6) : [];
    return {
      kind: 'astro_card',
      data: {
        park: park.name,
        parkCode,
        bortle,
        sqm: bortle != null ? sqmFromBortle(bortle) : null,
        ...getAstro(lat, lng, date),
        meteorShowers: meteorShowers(date),
        satellitePasses: passes,
        satellitesAvailable: tles.length > 0,
      },
    };
  },
});
