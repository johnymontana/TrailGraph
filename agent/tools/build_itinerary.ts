import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { createTrip, addStop, getTrip, deleteTrip } from '../../lib/trips';
import { resolveParkRefs } from '../../lib/park-resolve';
import { closureWarningsForTrip, tripBudget } from '../../lib/queries';
import { isFeeFreeDay } from '../../lib/datasources';
import { callerId } from '../../lib/agent-ctx';

/**
 * Create a trip and seed it with ordered park stops (C1-C2). Each entry may be a parkCode OR a park
 * name — we resolve names→codes via full-text so "save this as a trip" works even when the model
 * passes names (R2 §3.1). Invalid entries are skipped (and reported); if none resolve, no trip is
 * created and a clear error is returned (which the chat UI now renders). userId is server-bound (R4).
 *
 * Persistence path: call ONLY after the user agreed to save (e.g. clicked "Save this as a trip" or said
 * "yes, save"). To merely *propose* a plan, use `propose_itinerary` (no DB write) — see instructions §4.
 */
export default defineTool({
  description:
    'Create a named trip for the user from an ordered list of parks (park codes OR names; computes drive segments). Only call after the user agreed to build/save a trip.',
  inputSchema: z.object({
    name: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    parkCodes: z.array(z.string()).min(1).describe('Park codes or names, in visit order.'),
  }),
  async execute({ name, startDate, endDate, parkCodes }, ctx) {
    const userId = callerId(ctx);

    const { resolved, unresolved } = await resolveParkRefs(parkCodes);
    if (resolved.length === 0) {
      return { kind: 'itinerary_preview', data: { error: `I couldn't match any of those parks: ${parkCodes.join(', ')}. Try searching first.` } };
    }

    // Don't bake a day count into the name — it goes stale when stops are added later (R3 §4.5).
    const cleanName = name.replace(/\s*\((?:[^()]*\b\d+\s*-?\s*days?\b[^()]*)\)\s*$/i, '').trim() || name;
    const tripId = await createTrip(userId, { name: cleanName, startDate, endDate });
    for (const { code } of resolved) await addStop(userId, tripId, { kind: 'park', refId: code });
    const trip = await getTrip(userId, tripId);
    if (!trip || (trip.stops ?? []).filter(Boolean).length === 0) {
      await deleteTrip(userId, tripId);
      return { kind: 'itinerary_preview', data: { error: 'Could not add any valid stops to the trip.' } };
    }
    // F1 (plan P0-1): when the trip has dates, flag stops whose road/facility is closed then.
    const codes = resolved.map((p) => p.code);
    const closureWarnings = startDate ? await closureWarningsForTrip(codes, startDate).catch(() => []) : [];
    // F2 (plan P0-2): real entrance-fee budget (per vehicle) + fee-free-day awareness on the start date.
    const budget = await tripBudget(codes, 'vehicle').catch(() => null);
    const feeFreeDay = startDate ? isFeeFreeDay(startDate) : null;
    return { kind: 'itinerary_preview', data: { trip, unresolved, closureWarnings, budget, feeFreeDay } };
  },
});
