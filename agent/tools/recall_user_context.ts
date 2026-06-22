import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { memory } from '../../lib/memory';
import { getTravelConstraints, getAvailability, getHeldPasses } from '../../lib/bridges';
import { callerId, sessionId } from '../../lib/agent-ctx';

/**
 * D2: recall the user's saved preferences, interests, and prior context at turn start.
 * userId + conversationId come from the server-bound session context, never the model (R4).
 */
export default defineTool({
  description: "Recall the current user's saved preferences, interests, observations, and prior trips.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const userId = callerId(ctx);
    const conversationId = sessionId(ctx);
    const [context, prefs, constraints, availability, passes] = await Promise.all([
      memory.getConversationContext(userId, conversationId),
      memory.searchEntities({ userId, type: 'preference' }),
      getTravelConstraints(userId),
      getAvailability(userId),
      getHeldPasses(userId),
    ]);
    return {
      kind: 'map_snippet',
      data: {
        reflections: context.reflections,
        observations: context.observations,
        preferences: prefs.map((p) => ({ name: p.name, type: p.type, confidence: p.confidence })),
        // Accessibility / travel constraints — honor these in every recommendation + itinerary.
        travelConstraints: constraints,
        // Travel window (for event/season-aware suggestions) + entrance passes the user holds.
        availability,
        passes,
      },
    };
  },
});
