import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { saveTrail } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Record that the user has hiked a trail (ADR-071): `(:User)-[:DID]->(:Trail)`. Feeds difficulty
 * progression ("ready for your first strenuous?") and the "trails you've hiked" memory line. Call when
 * the user says they did a specific trail. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Record that the user has already hiked a trail ((:User)-[:DID]->(:Trail)). Call when they say they did a specific trail. Needs the trailId. Feeds difficulty progression and their hiking history.",
  inputSchema: z.object({
    trailId: z.string(),
  }),
  async execute({ trailId }, ctx) {
    const userId = callerId(ctx);
    const ok = await saveTrail(userId, trailId, 'did');
    if (!ok) return { kind: 'map_snippet', data: { error: `No trail found for id "${trailId}".` } };
    return { kind: 'map_snippet', data: { recorded: true, trailId } };
  },
});
