import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { explainGraph } from '../../lib/explain';
import { callerId } from '../../lib/agent-ctx';

/**
 * "Why this park?" (D4 / ADR-047): the literal explanatory edges — the user's PREFERS triples and the
 * concrete campground/amenity that satisfies each travel constraint — rendered as a `why_this` card
 * (the old `map_snippet` had no renderer and was dropped). userId is server-bound (R4); numbers/edges
 * are read from the graph, never the model.
 */
export default defineTool({
  description: "Explain why a specific park fits the current user, citing the exact graph edges from their stored preferences and travel constraints.",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }, ctx) {
    return { kind: 'why_this', data: await explainGraph(callerId(ctx), parkCode) };
  },
});
