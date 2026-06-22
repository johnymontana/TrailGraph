import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { semanticSearch } from '../../lib/queries';

/**
 * Semantic search over places/POIs (NPS-expansion vector search). For descriptive POI requests —
 * "a quiet overlook", "a place with an audio tour", "a passport-stamp spot" — matched against the
 * place's title/body/tags embedding. Results link to the related park page (no place detail route).
 */
export default defineTool({
  description:
    "Find places/points of interest by a descriptive query (e.g. 'a quiet overlook with a view', 'a spot with an audio description', 'a passport stamp location'). Semantic, not exact-name. Returns places with their related parks.",
  inputSchema: z.object({
    query: z.string().describe('A descriptive phrase, e.g. "quiet alpine overlook"'),
    limit: z.number().max(12).default(6),
  }),
  async execute({ query, limit }) {
    const results = await semanticSearch('place', query, limit);
    return { kind: 'node_results', data: { type: 'place', results } };
  },
});
