import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getLearningMemory } from '../../lib/learn-queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Ranger School D2: recall the user's full learning state in one graph call (mirrors recall_user_context).
 * Returns a `map_snippet` (model-context envelope, not a rendered card) so the tutor personalizes the turn.
 * userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Recall the current user's Ranger School learning state: enrolled courses, completed lessons, per-topic mastery, topics they struggle with, earned badges, and certificates. Call this early in a tutoring turn.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const userId = callerId(ctx);
    const m = await getLearningMemory(userId);
    return {
      kind: 'map_snippet',
      data: {
        enrolled: m.enrolled,
        completedLessons: m.completedLessons,
        mastery: m.mastery,
        struggling: m.struggling,
        badges: m.badges,
        certificates: m.certificates,
      },
    };
  },
});
