import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { semanticTrails } from '../../lib/queries';

/**
 * Semantic "vibe" trail search (ADR-072, Phase 4) over the `trail_embedding` index — describe the *feel*
 * ("a quiet alpine-lake hike with wildflowers under 5 mi", "a dramatic rim walk") and get the closest real
 * trails by meaning, not keywords. Returns trail cards. Empty until the `EMBED_TRAILS=1` pass runs —
 * fall back to `find_trails` for structured filters.
 */
export default defineTool({
  description:
    "Semantic 'vibe' trail search — describe the FEEL of the hike you want ('a quiet alpine-lake hike with wildflowers under 5 mi', 'a dramatic rim walk', 'easy forest stroll with a waterfall') and get the closest real trails by meaning. Use find_trails instead for hard numeric filters. Returns trail cards.",
  inputSchema: z.object({
    query: z.string().describe('A vibe / scene description of the desired hike'),
    limit: z.number().min(1).max(12).default(6),
  }),
  async execute({ query, limit }) {
    const trails = await semanticTrails(query, limit);
    return { kind: 'trail_card', data: { trails, total: trails.length, vibe: query } };
  },
});
