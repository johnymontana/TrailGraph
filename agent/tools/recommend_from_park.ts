import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { forYouFromNode } from '../../lib/recommend';
import { callerId } from '../../lib/agent-ctx';

/**
 * Graph-native "more like this park" (#9): 2-hop, novelty-aware recommendations seeded by a single park
 * (parks that share the seed's activities/topics), ranked with the user's loved preferences weighted over
 * generic shares. Reuses the `park_card` card (each rec carries `matched` for the "because they share …"
 * reason). userId is server-bound (R4). Unlike `recommend_for_user`, this does NOT record CONSIDERED bridges
 * — it's an exploratory branch off one park, not a curated set.
 */
export default defineTool({
  description:
    "Recommend parks similar to a specific park (parks that share its activities/topics), tailored to the user's preferences and excluding parks they've already considered or planned. Use when the user asks for parks 'like' or 'similar to' a given park.",
  inputSchema: z.object({
    parkCode: z.string().describe('The seed park code to recommend from, e.g. "yell".'),
    limit: z.number().max(20).default(8),
  }),
  async execute({ parkCode, limit }, ctx) {
    const userId = callerId(ctx);
    const { parks } = await forYouFromNode(userId, parkCode, { limit });
    return { kind: 'park_card', data: { parks } };
  },
});
