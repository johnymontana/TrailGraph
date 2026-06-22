import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { createTripFromTour, getTrip } from '../../lib/trips';
import { toursForPark } from '../../lib/queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Seed a trip from an official NPS tour (NPS-expansion P1 #3). A tour is a graph path of ordered
 * stops; we materialize it as a trip the user can then remix (reorder, drop strenuous stops, add a
 * stamp). Accepts a tour id directly, or a parkCode to pick the park's richest tour. Only call after
 * the user agreed to build a trip from a tour. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Create a trip seeded from an official NPS tour's ordered stops. Pass a tourId, or a parkCode to start from that park's most complete tour. Only after the user agreed to build the trip.",
  inputSchema: z.object({
    tourId: z.string().optional(),
    parkCode: z.string().optional().describe("Start from this park's richest tour when no tourId is known"),
  }),
  async execute({ tourId, parkCode }, ctx) {
    const userId = callerId(ctx);
    let id = tourId;
    if (!id && parkCode) {
      const tours = await toursForPark(parkCode, 1);
      id = tours[0]?.id;
    }
    if (!id) {
      return { kind: 'itinerary_preview', data: { error: 'No tour found to start from. Try a different park.' } };
    }
    const created = await createTripFromTour(userId, id);
    if (!created) {
      return { kind: 'itinerary_preview', data: { error: "That tour didn't have any stops I could add." } };
    }
    const trip = await getTrip(userId, created.tripId);
    return { kind: 'itinerary_preview', data: { trip, fromTour: true } };
  },
});
