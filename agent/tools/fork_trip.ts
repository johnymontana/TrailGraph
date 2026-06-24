import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { listTrips, getTrip } from '../../lib/trips';
import { forkTrip } from '../../lib/trip-lab';
import { callerId } from '../../lib/agent-ctx';

/** Resolve a trip reference (id or fuzzy name) to a tripId for the caller. */
async function resolveTripId(userId: string, tripId?: string, tripName?: string): Promise<string | null> {
  const trips = (await listTrips(userId)) as { id: string; name: string }[];
  if (tripId && trips.some((t) => t.id === tripId)) return tripId;
  if (!tripName) return null;
  const q = tripName.toLowerCase();
  return trips.find((t) => t.name.toLowerCase() === q)?.id ?? trips.find((t) => t.name.toLowerCase().includes(q))?.id ?? null;
}

/**
 * Fork (deep-copy) a saved trip so the user can experiment without touching the original (Trip Lab,
 * ADR-056) — e.g. "same trip but 3 days, drop Cedar Breaks". Identify the source by tripId (from
 * recall_user_context) or tripName. Returns the new trip; then remix it with add_stop / removeStop.
 * userId server-bound (R4).
 */
export default defineTool({
  description:
    'Fork (duplicate) a saved trip so the user can experiment — e.g. "same trip but drop a stop". ' +
    'Identify the source by tripId (from recall_user_context) or tripName. The original stays untouched; ' +
    'returns the new copy to remix with add_stop / removeStop. Optional name for the fork.',
  inputSchema: z.object({
    tripId: z.string().optional(),
    tripName: z.string().optional(),
    name: z.string().optional().describe('Optional name for the new fork; defaults to "<original> (copy)".'),
  }),
  async execute({ tripId, tripName, name }, ctx) {
    const userId = callerId(ctx);
    const src = await resolveTripId(userId, tripId, tripName);
    if (!src) return { kind: 'itinerary_preview', data: { error: "Couldn't find that trip — recall the user's trips first." } };
    const newId = await forkTrip(userId, src, name);
    if (!newId) return { kind: 'itinerary_preview', data: { error: 'trip not found' } };
    return { kind: 'itinerary_preview', data: { trip: await getTrip(userId, newId) } };
  },
});
