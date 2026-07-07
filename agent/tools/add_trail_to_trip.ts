import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { addTrailToStop, getTrip } from '../../lib/trips';
import { trailDetail } from '../../lib/queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Attach a hike to a stop on the user's trip (ADR-071): `(:Stop)-[:INCLUDES_TRAIL]->(:Trail)`. A hike is
 * nested UNDER a park stop, not a peer stop. Confirm-before-save (like start_trip_from_tour): the first
 * call (no `confirmed`) returns a preview — which trail, which day/stop — and writes nothing; only
 * `confirmed: true` persists the edge. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Add a hike to a stop on the user's trip ((:Stop)-[:INCLUDES_TRAIL]->(:Trail), nested under a park stop). WITHOUT `confirmed` it returns a preview (the trail + which day/stop) and writes nothing; pass `confirmed: true` only after the user agrees. Needs the tripId, the stopId of a park stop on that trip, and the trailId.",
  inputSchema: z.object({
    tripId: z.string(),
    stopId: z.string().describe('The stop on the trip to attach the hike to'),
    trailId: z.string(),
    confirmed: z.boolean().optional().describe('Persist the hike. Omit/false to show a preview first.'),
  }),
  async execute({ tripId, stopId, trailId, confirmed }, ctx) {
    const userId = callerId(ctx);
    const trail = await trailDetail(trailId);
    if (!trail) return { kind: 'trail_detail_card', data: { error: `No trail found for id "${trailId}".` } };

    const trip = await getTrip(userId, tripId);
    const stop = trip?.stops.find((s) => s.id === stopId);
    if (!trip || !stop) {
      return { kind: 'trail_detail_card', data: { error: "I couldn't find that stop on your trip." } };
    }
    const stopLabel = stop.parkName || stop.name || `Stop ${stop.order + 1}`;

    // Confirm-before-save: a preview (no write) until the user agrees (R5 §2.8 pattern).
    if (!confirmed) {
      return { kind: 'trail_detail_card', data: { ...trail, pendingAdd: { tripId, stopId, stopLabel, day: stop.day } } };
    }
    const ok = await addTrailToStop(userId, tripId, stopId, trailId);
    if (!ok) return { kind: 'trail_detail_card', data: { error: "I couldn't add that hike to your trip." } };
    // `addedTo.tripId` marks a CONFIRMED trip write for the chat panel's trips-changed scanner (ADR-076) —
    // previews (`pendingAdd`) deliberately never announce, since nothing was written.
    return { kind: 'trail_detail_card', data: { ...trail, addedTo: { tripId, stopLabel, day: stop.day } } };
  },
});
