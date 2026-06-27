import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { setTrailPreferences, getTrailPreferences } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Remember the user's STANDING trail preferences (ADR-071): a single `(:User)-[:PREFERS_TRAIL]->
 * (:TrailPrefs)` anchor (mirrors set_travel_constraints). Honored as defaults by find_trails + the
 * recommenders, and injected into the system prompt every turn. Durable — confirm scope first (standing
 * vs just-this-trip): for a one-trip-only filter, pass the constraints to find_trails instead of saving
 * here. A null/omitted field keeps the saved value. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Remember the user's STANDING trail preferences (max miles, max elevation gain, hardest difficulty, avoid exposure, must be dog-friendly) so every trail search + recommendation honors them. This is durable — confirm the scope first (standing vs just this trip). For a one-trip-only filter, pass those constraints to find_trails instead of saving here.",
  inputSchema: z.object({
    maxMiles: z.number().optional(),
    maxGainFt: z.number().optional(),
    difficulty: z.enum(['easy', 'moderate', 'strenuous']).optional().describe('Hardest difficulty the user wants'),
    avoidExposure: z.boolean().optional().describe('Avoid trails with steep drop-offs / exposure'),
    dogsRequired: z.boolean().optional().describe('Only dog-friendly trails'),
  }),
  async execute(args, ctx) {
    const userId = callerId(ctx);
    await setTrailPreferences(userId, args);
    return { kind: 'map_snippet', data: { saved: true, trailPreferences: await getTrailPreferences(userId) } };
  },
});
