import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { listWatches } from '../../lib/watches';
import { callerId } from '../../lib/agent-ctx';

/** List the user's standing watches (Proactive Ranger, ADR-052). userId-bound (R4). */
export default defineTool({
  description: "List the user's standing watches (trips/parks the daily digest is tracking).",
  inputSchema: z.object({}),
  async execute(_args, ctx) {
    const userId = callerId(ctx);
    return { kind: 'watch_list', data: { watches: await listWatches(userId) } };
  },
});
