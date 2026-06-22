import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { vibeSearch } from '../../lib/queries';
import { regionStates } from '../../lib/us-states';

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
  async execute({ query, region, stateCode, activity, topic, limit }) {
    const stateCodes = [
      ...new Set([...regionStates(region), ...(stateCode ? [stateCode.toUpperCase()] : [])]),
    ];
    const parks = await vibeSearch(query, { limit, stateCodes, activity, topic });
    return { kind: 'park_card', data: { parks } };
  },
});
