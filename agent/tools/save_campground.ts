import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { saveCampground } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Save a campground to the user's list (Campgrounds feature): `(:User)-[:SAVED]->(:Campground)`. Surfaced
 * in "your memory" + injected each turn. Needs the campgroundId from a card. userId-bound (R4).
 */
export default defineTool({
  description: "Save a campground to the user's list so it's easy to find later. Needs the campgroundId from a campground card.",
  inputSchema: z.object({ campgroundId: z.string() }),
  async execute({ campgroundId }, ctx) {
    const userId = callerId(ctx);
    const ok = await saveCampground(userId, campgroundId);
    if (!ok) return { kind: 'map_snippet', data: { error: `No campground found for id "${campgroundId}".` } };
    return { kind: 'map_snippet', data: { saved: true, campgroundId } };
  },
});
