import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { addLodgingToStop, getTrip } from '../../lib/trips';
import { campgroundDetail } from '../../lib/campgrounds';
import { callerId } from '../../lib/agent-ctx';

/**
 * Attach a campground to a stop as that night's lodging (Campgrounds feature): `(:Stop)-[:STAYS_AT]->
 * (:Campground)`, nested UNDER a park stop (like add_trail_to_trip nests a hike), NOT a peer stop. A stop
 * sleeps in ONE place, so this replaces any prior lodging. Confirm-before-save: the first call (no
 * `confirmed`) returns a preview and writes nothing; only `confirmed:true` persists. userId-bound (R4).
 * The ranger never books — adding lodging to a plan is not a reservation.
 */
export default defineTool({
  description:
    "Add a campground as the lodging for a stop on the user's trip ((:Stop)-[:STAYS_AT]->(:Campground), nested under a park stop). WITHOUT `confirmed` it returns a preview (the campground + which stop) and writes nothing; pass `confirmed:true` only after the user agrees. Needs tripId, the stopId of a stop on that trip, and the campgroundId. This plans where to sleep — it does NOT book or hold the site.",
  inputSchema: z.object({
    tripId: z.string(),
    stopId: z.string().describe('The stop this campground is the lodging for'),
    campgroundId: z.string(),
    date: z.string().optional().describe('Night this lodging covers, YYYY-MM-DD'),
    nights: z.number().optional(),
    confirmed: z.boolean().optional().describe('Persist the lodging. Omit/false to show a preview first.'),
  }),
  async execute({ tripId, stopId, campgroundId, date, nights, confirmed }, ctx) {
    const userId = callerId(ctx);
    const cg = await campgroundDetail(campgroundId);
    if (!cg) return { kind: 'campground_card', data: { error: `No campground found for id "${campgroundId}".` } };

    const trip = await getTrip(userId, tripId);
    const stop = trip?.stops.find((s) => s && s.id === stopId);
    if (!trip || !stop) return { kind: 'campground_card', data: { error: "I couldn't find that stop on your trip." } };
    const stopLabel = stop.parkName || stop.name || `Stop ${stop.order + 1}`;

    if (!confirmed) {
      return { kind: 'campground_card', data: { campground: cg, pendingAdd: { tripId, stopId, stopLabel, date } } };
    }
    const ok = await addLodgingToStop(userId, tripId, stopId, campgroundId, { date, nights });
    if (!ok) return { kind: 'campground_card', data: { error: "I couldn't add that campground to your trip." } };
    return { kind: 'campground_card', data: { campground: cg, addedTo: { stopLabel, date } } };
  },
});
