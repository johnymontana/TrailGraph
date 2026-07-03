import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { routing } from '../../lib/routing';
import { setHomeLocation, getHomeLocation, clearHomeLocation } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Remember where the user lives (user-feedback iteration): geocode a free-text place ("Bozeman, MT")
 * via the routing gateway and store it as the `(:User)-[:LIVES_AT]->(:Home)` anchor (migration 028).
 * Durable personal data — the instructions require confirming via ask_question before calling (same
 * scope rule as set_travel_constraints). Home feeds the trip-origin default, distance-from-home
 * ranking, and the memory block. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Remember the user's home location (city/town) so trips can start from home and recommendations can rank by distance. Confirm with the user before saving; pass clear=true to forget it.",
  inputSchema: z.object({
    place: z.string().optional().describe("Free-text home place, e.g. 'Bozeman, MT'"),
    clear: z.boolean().optional().describe('Forget the saved home location instead of setting one'),
  }),
  async execute({ place, clear }, ctx) {
    const userId = callerId(ctx);
    if (clear) {
      await clearHomeLocation(userId);
      return { kind: 'map_snippet', data: { cleared: true } };
    }
    if (!place?.trim()) return { error: 'Provide a place to save (or clear=true to forget).' };
    const hit = await routing.geocode(place);
    if (!hit) return { error: `Could not find "${place}" — ask the user for a nearby city or town.` };
    await setHomeLocation(userId, { ...hit, source: 'geocode' });
    return { kind: 'map_snippet', data: { saved: true, home: await getHomeLocation(userId) } };
  },
});
