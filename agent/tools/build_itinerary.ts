import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { createTrip, addStop, getTrip, deleteTrip } from '../../lib/trips';
import { readGraph } from '../../lib/neo4j';
import { callerId } from '../../lib/agent-ctx';

/**
 * Create a trip and seed it with ordered park stops (C1-C2). Each entry may be a parkCode OR a park
 * name — we resolve names→codes via full-text so "save this as a trip" works even when the model
 * passes names (R2 §3.1). Invalid entries are skipped (and reported); if none resolve, no trip is
 * created and a clear error is returned (which the chat UI now renders). userId is server-bound (R4).
 */
async function resolveToParkCode(q: string): Promise<string | null> {
  const rows = await readGraph<{ code: string }>(
    `CALL {
       MATCH (p:Park {parkCode: toLower($q)}) RETURN p.parkCode AS code, 1 AS rank
       UNION
       CALL db.index.fulltext.queryNodes('park_fulltext', $q) YIELD node, score
       RETURN node.parkCode AS code, 2 AS rank ORDER BY score DESC LIMIT 1
     }
     RETURN code ORDER BY rank ASC LIMIT 1`,
    { q },
  );
  return rows[0]?.code ?? null;
}

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

    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const entry of parkCodes) {
      const code = await resolveToParkCode(entry);
      if (code && !resolved.includes(code)) resolved.push(code);
      else if (!code) unresolved.push(entry);
    }
    if (resolved.length === 0) {
      return { kind: 'itinerary_preview', data: { error: `I couldn't match any of those parks: ${parkCodes.join(', ')}. Try searching first.` } };
    }

    // Don't bake a day count into the name — it goes stale when stops are added later (R3 §4.5).
    const cleanName = name.replace(/\s*\((?:[^()]*\b\d+\s*-?\s*days?\b[^()]*)\)\s*$/i, '').trim() || name;
    const tripId = await createTrip(userId, { name: cleanName, startDate, endDate });
    for (const code of resolved) await addStop(userId, tripId, { kind: 'park', refId: code });
    const trip = await getTrip(userId, tripId);
    if (!trip || (trip.stops ?? []).filter(Boolean).length === 0) {
      await deleteTrip(userId, tripId);
      return { kind: 'itinerary_preview', data: { error: 'Could not add any valid stops to the trip.' } };
    }
    return { kind: 'itinerary_preview', data: { trip, unresolved } };
  },
});
