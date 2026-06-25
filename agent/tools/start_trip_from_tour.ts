import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { createTripFromTour, getTrip, previewTourFromTour } from '../../lib/trips';
import { toursForPark } from '../../lib/queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Seed a trip from an official NPS tour (NPS-expansion P1 #3). A tour is a graph path of ordered
 * stops; we materialize it as a trip the user can then remix (reorder, drop strenuous stops, add a
 * stamp). Accepts a tour id directly, or a parkCode to pick the park's richest tour.
 *
 * Confirm-before-save (P1.3): like propose_itinerary, the first call (no `confirmed`) returns a SAVEABLE
 * DRAFT preview and writes nothing; only `confirmed: true` persists the trip. The draft carries `tourId`
 * so the agreement call re-uses the same tour. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Seed a trip from an official NPS tour's ordered stops. Pass a tourId, or a parkCode to start from that park's richest tour. WITHOUT `confirmed` it returns a saveable preview card and writes nothing; pass `confirmed: true` (with the same tourId) only after the user agrees to save — do NOT use build_itinerary to save a tour draft, call this again with confirmed:true.",
  inputSchema: z.object({
    tourId: z.string().optional(),
    parkCode: z.string().optional().describe("Start from this park's richest tour when no tourId is known"),
    confirmed: z.boolean().optional().describe('Persist the trip. Omit/false to show a saveable preview first.'),
  }),
  async execute({ tourId, parkCode, confirmed }, ctx) {
    const userId = callerId(ctx);
    let id = tourId;
    if (!id && parkCode) {
      const tours = await toursForPark(parkCode, 1);
      id = tours[0]?.id;
    }
    if (!id) {
      return { kind: 'itinerary_preview', data: { error: 'No tour found to start from. Try a different park.' } };
    }
    // Confirm-before-save: show a draft (no write) until the user agrees (R5 §2.8 pattern, P1.3).
    if (!confirmed) {
      const preview = await previewTourFromTour(id);
      if (!preview) {
        return { kind: 'itinerary_preview', data: { error: "That tour didn't have any stops I could add." } };
      }
      // `draft: true` + `tourId` → ItineraryCard renders "Save this as a trip"; agreement re-calls THIS tool
      // with confirmed:true (NOT build_itinerary — tour stops are places/VCs, not parks).
      return { kind: 'itinerary_preview', data: { draft: true, fromTour: true, tourId: id, trip: preview } };
    }
    const created = await createTripFromTour(userId, id);
    if (!created) {
      return { kind: 'itinerary_preview', data: { error: "That tour didn't have any stops I could add." } };
    }
    const trip = await getTrip(userId, created.tripId);
    return { kind: 'itinerary_preview', data: { trip, fromTour: true } };
  },
});
