import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parksInRegion } from '../../lib/queries';

/**
 * Parks in a curated geographic region (plan F9/P1-3) — `(:Park)-[:IN_REGION]->(:Region)`. Backs
 * regional discovery ("show me parks in the Southwest") as a one-hop traversal. Graph-grounded (R6).
 */
export default defineTool({
  description:
    "List national parks in a curated geographic region (e.g. 'Pacific West', 'Rocky Mountains', 'Southwest', 'Midwest', 'Southeast', 'Northeast', 'Alaska') — for regional trip discovery.",
  inputSchema: z.object({
    region: z.string(),
    limit: z.number().min(1).max(40).default(20),
  }),
  async execute({ region, limit }) {
    const parks = await parksInRegion(region, limit);
    if (!parks.length) return { kind: 'park_card', data: { error: `No parks found in region "${region}".` } };
    return { kind: 'park_card', data: { parks } };
  },
});
