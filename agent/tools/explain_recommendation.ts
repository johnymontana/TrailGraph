import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { explainRecommendation } from '../../lib/explain';
import { callerId } from '../../lib/agent-ctx';

/**
 * "Why this?" (D4): explain why a park fits the user, grounded in the graph bridge
 * (their PREFERS → Activity/Topic that the park offers). userId is server-bound (R4).
 */
export default defineTool({
  description: "Explain why a specific park was recommended to the current user, citing their stored preferences.",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }, ctx) {
    const explanation = await explainRecommendation(callerId(ctx), parkCode);
    return { kind: 'map_snippet', data: explanation };
  },
});
