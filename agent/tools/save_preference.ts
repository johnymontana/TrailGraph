import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { recordPreference } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * The only memory WRITE tool (ADR-009): intentional "remember that I prefer X" facts.
 * Writes the raw fact to NAMS AND a deterministic canonical (:User)-[:PREFERS]->(:Activity|:Topic)
 * bridge (ADR-011). userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Persist an explicit user preference the user clearly stated (e.g. 'I prefer campgrounds', 'I love dark skies', 'I avoid crowds').",
  inputSchema: z.object({
    category: z.enum([
      'activity',
      'topic',
      'terrain',
      'vibe',
      'crowd',
      'season',
      'accessibility',
      'budget',
    ]),
    value: z.string(),
  }),
  async execute({ category, value }, ctx) {
    const userId = callerId(ctx);
    const result = await recordPreference({ userId, category, value });
    return { kind: 'map_snippet', data: { saved: { category, value }, ...result } };
  },
});
