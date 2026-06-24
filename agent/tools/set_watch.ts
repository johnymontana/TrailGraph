import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { listTrips } from '../../lib/trips';
import { parkDetail } from '../../lib/queries';
import { createWatch, listWatches } from '../../lib/watches';
import { callerId } from '../../lib/agent-ctx';

/**
 * Set a standing watch on a trip or park (Proactive Ranger, ADR-052). The daily digest then surfaces
 * road/gate closures, clear-sky new-moon windows, fee-free days, and alert spikes for it in the user's
 * inbox (and opt-in email). Identify a trip by tripId/tripName, a park by parkCode. userId-bound (R4).
 */
export default defineTool({
  description:
    'Set a standing watch so the daily ranger digest tracks a trip or park (closures, clear-sky new-moon ' +
    'windows, fee-free days, alerts). For a trip pass tripId (from recall_user_context) or tripName; for a ' +
    "park pass parkCode. Only call when the user asks to watch/monitor/get alerts about something.",
  inputSchema: z.object({
    kind: z.enum(['trip', 'park']),
    tripId: z.string().optional(),
    tripName: z.string().optional(),
    parkCode: z.string().optional(),
  }),
  async execute({ kind, tripId, tripName, parkCode }, ctx) {
    const userId = callerId(ctx);
    if (kind === 'park') {
      if (!parkCode) return { kind: 'watch_list', data: { error: 'parkCode required to watch a park.' } };
      const park = await parkDetail(parkCode);
      if (!park) return { kind: 'watch_list', data: { error: `No such park: ${parkCode}.` } };
      await createWatch(userId, 'park', parkCode, park.name as string);
    } else {
      const trips = (await listTrips(userId)) as { id: string; name: string }[];
      let id = tripId && trips.some((t) => t.id === tripId) ? tripId : undefined;
      if (!id && tripName) {
        const q = tripName.toLowerCase();
        id = trips.find((t) => t.name.toLowerCase() === q)?.id ?? trips.find((t) => t.name.toLowerCase().includes(q))?.id;
      }
      if (!id) return { kind: 'watch_list', data: { error: "Couldn't find that trip — recall the user's trips first." } };
      const label = trips.find((t) => t.id === id)?.name;
      await createWatch(userId, 'trip', id, label);
    }
    return { kind: 'watch_list', data: { watches: await listWatches(userId) } };
  },
});
