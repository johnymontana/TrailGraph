import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { checkTripAlerts } from '../../lib/trips';
import { callerId } from '../../lib/agent-ctx';

/** Per-trip alert check (C3): park-level Closure/Danger + best-effort campground mentions (ADR-005). */
export default defineTool({
  description: 'Check a trip for active Closure/Danger alerts on any park (and campground-name mentions) along the itinerary.',
  inputSchema: z.object({ tripId: z.string() }),
  async execute({ tripId }, ctx) {
    const userId = callerId(ctx);
    return { kind: 'alert_list', data: { parks: await checkTripAlerts(userId, tripId) } };
  },
});
