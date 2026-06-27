import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { saveTrail } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Save a trail to the user's list (ADR-071): `(:User)-[:SAVED|WISHLISTED]->(:Trail)`. `saved` = a trail
 * they want handy; `wishlisted` = bucket list. Surfaced in "your memory" + injected each turn. Use
 * `record_trail_done` for a trail they've already hiked. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Save a trail to the user's list. kind 'saved' = keep it handy; kind 'wishlisted' = bucket list (want to do). Needs the trailId from a trail card. For a trail they've ALREADY hiked, use record_trail_done instead.",
  inputSchema: z.object({
    trailId: z.string(),
    kind: z.enum(['saved', 'wishlisted']).default('saved'),
  }),
  async execute({ trailId, kind }, ctx) {
    const userId = callerId(ctx);
    const ok = await saveTrail(userId, trailId, kind);
    if (!ok) return { kind: 'map_snippet', data: { error: `No trail found for id "${trailId}".` } };
    return { kind: 'map_snippet', data: { saved: true, trailId, savedKind: kind } };
  },
});
