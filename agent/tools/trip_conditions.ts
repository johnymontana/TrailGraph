import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { tripConditions } from '../../lib/trips';
import { callerId } from '../../lib/agent-ctx';

/**
 * The Trip Dashboard (ADR-042): per-stop conditions (dark-sky, crowd, best months, live weather, temp
 * band) for one of the user's built trips, as a structured `trip_dashboard` card rather than prose.
 * userId is server-bound via callerId (R4) — never a model-supplied id.
 */
export default defineTool({
  description:
    "Show a data-dense conditions dashboard for one of the user's saved trips (dark-sky, crowds, weather, temps per stop), by tripId.",
  inputSchema: z.object({ tripId: z.string() }),
  async execute({ tripId }, ctx) {
    const userId = callerId(ctx);
    const dashboard = await tripConditions(userId, tripId);
    if (!dashboard) return { kind: 'trip_dashboard', data: { error: `No trip ${tripId} for this user.` } };
    return { kind: 'trip_dashboard', data: dashboard };
  },
});
