import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { listTrips } from '../../lib/trips';
import { tripDiff } from '../../lib/trip-lab';
import { callerId } from '../../lib/agent-ctx';

/** Resolve a trip reference (id or fuzzy name) to a tripId for the caller. */
async function resolve(userId: string, ref: string, trips: { id: string; name: string }[]): Promise<string | null> {
  if (trips.some((t) => t.id === ref)) return ref;
  const q = ref.toLowerCase();
  return trips.find((t) => t.name.toLowerCase() === q)?.id ?? trips.find((t) => t.name.toLowerCase().includes(q))?.id ?? null;
}

/**
 * Compare two of the user's trips side-by-side (Trip Lab, ADR-056): drive time, dark hours, entrance
 * cost, and risk (active Closure/Danger alert load). Each `a`/`b` is a tripId (from recall_user_context)
 * or a trip name. Renders a `trip_diff` card — reference it in prose, don't re-list the numbers.
 */
export default defineTool({
  description:
    'Compare two saved trips side-by-side (drive time, dark hours, entrance cost, risk). Each of a/b is ' +
    'a tripId (from recall_user_context) or a trip name. Great after fork_trip to weigh the variants.',
  inputSchema: z.object({
    a: z.string().describe('First trip: tripId or name.'),
    b: z.string().describe('Second trip: tripId or name.'),
  }),
  async execute({ a, b }, ctx) {
    const userId = callerId(ctx);
    const trips = (await listTrips(userId)) as { id: string; name: string }[];
    const aId = await resolve(userId, a, trips);
    const bId = await resolve(userId, b, trips);
    if (!aId || !bId) return { kind: 'trip_diff', data: { error: "Couldn't find one of those trips — recall the user's trips first." } };
    const diff = await tripDiff(userId, aId, bId);
    if (!diff) return { kind: 'trip_diff', data: { error: 'trip not found' } };
    return { kind: 'trip_diff', data: diff };
  },
});
