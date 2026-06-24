import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { deleteWatch, listWatches } from '../../lib/watches';
import { callerId } from '../../lib/agent-ctx';

/** Remove a standing watch by its id (Proactive Ranger, ADR-052). userId-bound (R4). */
export default defineTool({
  description: 'Stop watching a trip or park — remove a standing watch by its watchId (from list_watches).',
  inputSchema: z.object({ watchId: z.string() }),
  async execute({ watchId }, ctx) {
    const userId = callerId(ctx);
    await deleteWatch(userId, watchId);
    return { kind: 'watch_list', data: { watches: await listWatches(userId) } };
  },
});
