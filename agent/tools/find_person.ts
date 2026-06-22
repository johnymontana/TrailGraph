import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { semanticSearch } from '../../lib/queries';

/**
 * Semantic search over historical figures (NPS-expansion vector search). For descriptive people
 * requests — "figures connected to photography", "people tied to the conservation movement" — matched
 * against the person's title/body/tags embedding. Differs from `find_trail`, which takes a *named*
 * figure and returns the parks on their cross-park trail. Results link to the person's related parks.
 */
export default defineTool({
  description:
    "Find historical figures by a descriptive query (e.g. 'people connected to photography', 'figures from the conservation movement'). Semantic, not exact-name — use find_trail when the user names a specific person. Returns people with their related parks.",
  inputSchema: z.object({
    query: z.string().describe('A descriptive phrase, e.g. "photographers and naturalists"'),
    limit: z.number().max(12).default(6),
  }),
  async execute({ query, limit }) {
    const results = await semanticSearch('person', query, limit);
    return { kind: 'node_results', data: { type: 'person', results } };
  },
});
