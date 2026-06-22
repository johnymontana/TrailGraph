import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { addStop, getTrip } from '../../lib/trips';
import { callerId } from '../../lib/agent-ctx';

/** Add a stop (park / campground / thing-to-do / custom) to an existing trip (C2). userId server-bound (R4). */
export default defineTool({
  description: 'Add a stop to an existing trip and recompute drive segments.',
  inputSchema: z.object({
    tripId: z.string(),
    kind: z.enum(['park', 'campground', 'poi', 'custom']),
    refId: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    name: z.string().optional(),
    day: z.number().optional(),
    nights: z.number().optional(),
  }),
  async execute({ tripId, kind, refId, latitude, longitude, name, day, nights }, ctx) {
    const userId = callerId(ctx);
    const stopId = await addStop(userId, tripId, { kind, refId, lat: latitude, lng: longitude, name, day, nights });
    if (!stopId) return { kind: 'itinerary_preview', data: { error: 'trip not found' } };
    return { kind: 'itinerary_preview', data: { stopId, trip: await getTrip(userId, tripId) } };
  },
});
