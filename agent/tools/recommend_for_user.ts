import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { forYou } from '../../lib/recommend';
import { considerPark } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Personalized, novelty-aware recommendations (the §8.3 differentiator). Records a CONSIDERED bridge
 * (Path A) for each recommended park. userId is server-bound (R4).
 */
export default defineTool({
  description: "Recommend parks tailored to the current user's saved preferences, excluding parks they've already considered or planned.",
  inputSchema: z.object({
    limit: z.number().max(20).default(8),
    homeLatitude: z.number().optional(),
    homeLongitude: z.number().optional(),
  }),
  async execute({ limit, homeLatitude, homeLongitude }, ctx) {
    const userId = callerId(ctx);
    const { source, parks } = await forYou(userId, { limit, homeLat: homeLatitude, homeLng: homeLongitude });
    await Promise.all(parks.map((p) => considerPark(userId, p.parkCode)));
    return { kind: 'park_card', data: { source, parks } };
  },
});
