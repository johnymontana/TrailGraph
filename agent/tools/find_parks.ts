import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { vibeSearch } from '../../lib/queries';
import { regionStates } from '../../lib/us-states';
import { getTravelConstraints, mergeConstraints } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Intent-aware park finder (R4 §2.3): semantic vibe search narrowed by region/activity/topic, so the
 * cards the user sees match the query (not loosely full-text-matched parks). Prefer this over
 * `search_parks` for descriptive asks like "waterfalls and old-growth forests in the Pacific Northwest".
 * Graph-grounded results only (R6).
 */
export default defineTool({
  description:
    "Find parks for a thematic/'vibe' query via semantic search, optionally narrowed by region, activity, or topic. Use this for descriptive requests (e.g. 'waterfalls and old-growth forests in the PNW'); use search_parks only for exact name/state lookups.",
  inputSchema: z.object({
    query: z.string().describe('The theme/vibe, e.g. "waterfalls and old-growth forests"'),
    region: z
      .string()
      .optional()
      .describe('A US region ("Pacific Northwest", "Southwest", "Rockies") or state name — narrows to those states'),
    stateCode: z.string().length(2).optional().describe('A specific 2-letter state code'),
    activity: z.string().optional().describe('An exact NPS activity name to require'),
    topic: z.string().optional().describe('An exact NPS topic name to require'),
    // Per-query (trip-scoped) constraints (R5 §2.2): pass these to honor a need that belongs to THIS
    // trip only — e.g. a companion's wheelchair need — WITHOUT saving it as a durable global filter.
    // They layer on top of the user's saved constraints for this search only. For the user's OWN
    // standing needs, call `set_travel_constraints` instead so they persist.
    wheelchairAccessible: z.boolean().optional().describe('Require wheelchair-accessible camping for THIS search only (not saved)'),
    rvMaxLengthFt: z.number().optional().describe('Require campgrounds fitting this RV length for THIS search only (not saved)'),
    requiredAmenities: z.array(z.string()).optional().describe('Exact NPS amenity names to require for THIS search only (not saved)'),
    limit: z.number().max(12).default(6),
  }),
  async execute({ query, region, stateCode, activity, topic, wheelchairAccessible, rvMaxLengthFt, requiredAmenities, limit }, ctx) {
    const stateCodes = [
      ...new Set([...regionStates(region), ...(stateCode ? [stateCode.toUpperCase()] : [])]),
    ];
    // Start from the user's SAVED (durable) travel constraints (ADR-046) so cards match a constrained
    // final answer (Friction #2). Anonymous sessions (callerId throws) just skip them.
    let saved: { wheelchair: boolean; rvMaxLengthFt: number | null; requiredAmenities: string[] } = {
      wheelchair: false,
      rvMaxLengthFt: null,
      requiredAmenities: [],
    };
    try {
      saved = await getTravelConstraints(callerId(ctx));
    } catch {
      /* anonymous — no constraints to apply */
    }
    // Merge durable + per-query (trip-scoped) constraints (R5 §2.2). The merged set is applied to
    // retrieval only — the per-query needs are never persisted, so they don't leak into future trips.
    const merged = mergeConstraints(saved, { wheelchair: wheelchairAccessible, rvMaxLengthFt, requiredAmenities });
    const parks = await vibeSearch(query, {
      limit,
      stateCodes,
      activity,
      topic,
      rvMaxLengthFt: merged.rvMaxLengthFt,
      wheelchairAccessible: merged.wheelchair,
      requiredAmenities: merged.requiredAmenities,
    });
    // Server-derived labels for the applied constraints — makes the narrowing legible (no fabricated
    // counts, no prose parsing).
    const narrowedBy: string[] = [];
    if (merged.rvMaxLengthFt) narrowedBy.push(`fits a ${merged.rvMaxLengthFt} ft RV`);
    if (merged.wheelchair) narrowedBy.push('wheelchair-accessible camping');
    for (const a of merged.requiredAmenities) narrowedBy.push(a.toLowerCase());
    return { kind: 'park_card', data: { parks, narrowedBy: narrowedBy.length ? narrowedBy : undefined } };
  },
});
