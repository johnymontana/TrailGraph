import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getTrip } from '../../lib/trips';
import { suggestDays } from '../../lib/itinerary';
import { callerId } from '../../lib/agent-ctx';

/**
 * Suggested day-by-day structure for a trip (C4): groups stops into days honoring a drive+visit
 * budget. Returns an itinerary preview with day assignments. userId is server-bound (R4).
 */
export default defineTool({
  description: 'Propose a day-by-day plan for a trip, grouping its stops into days by pacing (drive + visit time).',
  inputSchema: z.object({ tripId: z.string(), maxHoursPerDay: z.number().min(2).max(14).optional() }),
  async execute({ tripId, maxHoursPerDay }, ctx) {
    const userId = callerId(ctx);
    const trip = await getTrip(userId, tripId);
    if (!trip) return { kind: 'itinerary_preview', data: { error: 'trip not found' } };
    const stops = ((trip.stops ?? []).filter(Boolean) as {
      id: string;
      parkName?: string;
      name?: string;
      driveTo?: { minutes: number } | null;
    }[]);
    const assignments = suggestDays(
      stops.map((s) => ({ id: s.id, driveMinutesToHere: s.driveTo?.minutes ?? 0 })),
      maxHoursPerDay ? { maxMinutesPerDay: maxHoursPerDay * 60 } : {},
    );
    const dayById = new Map(assignments.map((a) => [a.id, a.day]));
    return {
      kind: 'itinerary_preview',
      data: {
        // Include trip.id so the chat dedups all itinerary cards from one build to a single rendered
        // card (R5 §2.7) — build_itinerary/add_stop/fork all key by trip.id too.
        trip: { id: trip.id, name: trip.name, stops: stops.map((s) => ({ ...s, day: dayById.get(s.id) })) },
        // Read-only: the day plan is a suggestion in this card, NOT persisted to the trip. Marks the
        // output so the plan panel's trips-changed scanner (lib/chat-trips.ts, ADR-076) doesn't treat it
        // as a write — a spurious cross-pane refresh + "itinerary changed" tab flash.
        readOnly: true,
        days: Math.max(0, ...assignments.map((a) => a.day)),
      },
    };
  },
});
