import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { setTravelConstraints, getTravelConstraints } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Capture how the user travels (NPS-expansion P0 #1): wheelchair need, RV length, and required
 * amenities. Stored once on the context graph (`TRAVELS_WITH`/`REQUIRES`) and honored by every
 * subsequent recommendation + itinerary. Call when the user states a need ("I use a wheelchair",
 * "we have a 30-ft RV", "I need accessible restrooms"). userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Remember the user's accessibility / travel constraints (wheelchair, RV length in feet, required amenities) so all recommendations respect them.",
  inputSchema: z.object({
    wheelchair: z.boolean().optional(),
    rvMaxLengthFt: z.number().optional(),
    requiredAmenities: z.array(z.string()).optional().describe('Exact NPS amenity names the user requires'),
  }),
  async execute({ wheelchair, rvMaxLengthFt, requiredAmenities }, ctx) {
    const userId = callerId(ctx);
    await setTravelConstraints(userId, { wheelchair, rvMaxLengthFt, requiredAmenities });
    return { kind: 'map_snippet', data: { saved: true, constraints: await getTravelConstraints(userId) } };
  },
});
