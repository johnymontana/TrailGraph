import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { listCampWatches } from '../../lib/camp-watches';
import { callerId } from '../../lib/agent-ctx';

/** List the user's Camp Watches (Campgrounds feature) — management parity with list_watches. userId-bound (R4). */
export default defineTool({
  description: "List the user's active Camp Watches (campground cancellation alerts), so they can review or clear them.",
  inputSchema: z.object({}),
  async execute(_args, ctx) {
    const userId = callerId(ctx);
    return { kind: 'camp_watch_card', data: { watches: await listCampWatches(userId) } };
  },
});
