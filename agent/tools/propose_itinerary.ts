import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { resolveParkRefs } from '../../lib/park-resolve';
import { decodeEntities } from '../../lib/html-entities';

/**
 * PROPOSE a multi-park plan as a preview card the user can save with one tap — WITHOUT persisting a trip
 * (R5 §2.8). This keeps "offer first, then act": the ranger shows a `draft` itinerary card with a "Save
 * this as a trip" button; only when the user agrees does it call `build_itinerary`. Use this whenever you
 * lay out a multi-day plan you haven't been asked to save yet — it makes saving predictable instead of a
 * coin-flip. Park entries may be codes OR names (resolved identically to build_itinerary). No DB write.
 */
export default defineTool({
  description:
    'Show a proposed multi-park plan as a saveable preview card WITHOUT creating a trip (parks by code or name, in visit order). Use this to lay out a plan before the user has agreed to save it; they tap "Save this as a trip" to persist via build_itinerary.',
  inputSchema: z.object({
    name: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    parkCodes: z.array(z.string()).min(1).describe('Park codes or names, in visit order.'),
  }),
  async execute({ name, startDate, endDate, parkCodes }) {
    const { resolved, unresolved } = await resolveParkRefs(parkCodes);
    if (resolved.length === 0) {
      return { kind: 'itinerary_preview', data: { error: `I couldn't match any of those parks: ${parkCodes.join(', ')}. Try searching first.` } };
    }
    // Same name-cleaning as build_itinerary (no stale day count), and decode model entities so the draft
    // card shows "&", not "&amp;" (R5 §2.1).
    const cleanName = decodeEntities(name).replace(/\s*\((?:[^()]*\b\d+\s*-?\s*days?\b[^()]*)\)\s*$/i, '').trim() || decodeEntities(name);
    return {
      kind: 'itinerary_preview',
      data: {
        // `draft: true` + no `trip.id` → the card renders a "Save this as a trip" action and ChatPanel's
        // trips-changed announce (which keys on trip.id) does NOT fire.
        draft: true,
        parkCodes: resolved.map((p) => p.code),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        unresolved,
        trip: { name: cleanName, stops: resolved.map((p) => ({ parkName: p.name })) },
      },
    };
  },
});
