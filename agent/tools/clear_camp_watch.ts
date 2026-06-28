import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { deleteCampWatch, listCampWatches } from '../../lib/camp-watches';
import { callerId } from '../../lib/agent-ctx';

/** Remove a Camp Watch (Campgrounds feature) — parity with clear_watch. userId-bound so a user can only clear their own (R4). */
export default defineTool({
  description: "Remove one of the user's Camp Watches by its watchId (from list_camp_watches / the camp watch card).",
  inputSchema: z.object({ watchId: z.string() }),
  async execute({ watchId }, ctx) {
    const userId = callerId(ctx);
    await deleteCampWatch(userId, watchId);
    return { kind: 'camp_watch_card', data: { watches: await listCampWatches(userId), cleared: watchId } };
  },
});
