import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { vibeSearch } from '../../lib/queries';
import { regionStates } from '../../lib/us-states';
import { getTravelConstraints } from '../../lib/bridges';
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
    limit: z.number().max(12).default(6),
  }),
  async execute({ query, region, stateCode, activity, topic, limit }, ctx) {
    const stateCodes = [
      ...new Set([...regionStates(region), ...(stateCode ? [stateCode.toUpperCase()] : [])]),
    ];
    // Apply the user's SAVED travel constraints to candidate retrieval (ADR-046) so the cards match a
    // constrained final answer (Friction #2). Anonymous sessions (callerId throws) just skip them.
    let cons: { wheelchair: boolean; rvMaxLengthFt: number | null; requiredAmenities: string[] } = {
      wheelchair: false,
      rvMaxLengthFt: null,
      requiredAmenities: [],
    };
    try {
      cons = await getTravelConstraints(callerId(ctx));
    } catch {
      /* anonymous — no constraints to apply */
    }
    const parks = await vibeSearch(query, {
      limit,
      stateCodes,
      activity,
      topic,
      rvMaxLengthFt: cons.rvMaxLengthFt,
      wheelchairAccessible: cons.wheelchair,
      requiredAmenities: cons.requiredAmenities,
    });
    // Server-derived labels for the applied constraints — makes the narrowing legible (no fabricated
    // counts, no prose parsing).
    const narrowedBy: string[] = [];
    if (cons.rvMaxLengthFt) narrowedBy.push(`fits a ${cons.rvMaxLengthFt} ft RV`);
    if (cons.wheelchair) narrowedBy.push('wheelchair-accessible camping');
    for (const a of cons.requiredAmenities) narrowedBy.push(a.toLowerCase());
    return { kind: 'park_card', data: { parks, narrowedBy: narrowedBy.length ? narrowedBy : undefined } };
  },
});
