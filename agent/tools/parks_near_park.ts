import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { nearParks, nearbyParks } from '../../lib/queries';

/**
 * Parks near another park (plan F9): uses the materialized NEAR proximity graph ("what else is within
 * range of Mesa Verde?") to seed a tight multi-park trip. Falls back to a runtime great-circle search if
 * the NEAR edges aren't built yet. Graph-grounded (R6). Straight-line distance, not drive time.
 */
export default defineTool({
  description:
    "Find national parks geographically near another park (by parkCode) — for building a tight multi-park road trip. Returns nearby parks with straight-line distance in miles.",
  inputSchema: z.object({
    parkCode: z.string(),
    limit: z.number().min(1).max(15).default(8),
  }),
  async execute({ parkCode, limit }) {
    let parks = await nearParks(parkCode, limit);
    if (!parks.length) parks = await nearbyParks(parkCode, 200, limit); // fallback before NEAR is derived
    if (!parks.length) return { kind: 'park_card', data: { error: `No parks found near ${parkCode}.` } };
    return { kind: 'park_card', data: { parks } };
  },
});
