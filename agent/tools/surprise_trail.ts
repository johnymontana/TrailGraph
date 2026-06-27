import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { randomTrails } from '../../lib/queries';

/**
 * "Surprise me" (ADR-072, Phase 4) — a random trail to discover, for the spontaneous. Returns trail cards.
 */
export default defineTool({
  description:
    "Surprise the user with a random real trail to discover (for 'surprise me' / spontaneous asks). Returns trail card(s).",
  inputSchema: z.object({
    count: z.number().min(1).max(5).default(1),
  }),
  async execute({ count }) {
    const trails = await randomTrails(count);
    return { kind: 'trail_card', data: { trails, total: trails.length, surprise: true } };
  },
});
