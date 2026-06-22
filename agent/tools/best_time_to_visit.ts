import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { monthNames } from '../../lib/datasources';

/**
 * Structured conditions for a park (§5b/§5a): lowest-crowd months, typical crowd level, and dark-sky
 * rating — so the ranger cites real data instead of vague prose. Graph-grounded (R6).
 */
export default defineTool({
  description:
    "Best time to visit a park (lowest-crowd months), its typical crowd level, and dark-sky quality, by parkCode.",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }) {
    const park = await parkDetail(parkCode);
    if (!park) return { kind: 'map_snippet', data: { error: `No park with code ${parkCode}` } };
    return {
      kind: 'map_snippet',
      data: {
        park: park.name,
        bestMonths: monthNames((park.bestMonths as number[]) ?? []) || null,
        crowdLevel: park.crowdLevel ?? null,
        darkSkyCertified: park.darkSkyCertified ?? false,
        bortleScale: park.bortleScale ?? null,
      },
    };
  },
});
