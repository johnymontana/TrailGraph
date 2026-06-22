import { defineHook } from 'eve/hooks';
import type { HookContext } from 'eve/hooks';
import { memory } from '../../lib/memory';
import { getOrCreateConversation } from '../../lib/agent-session';

/**
 * Deterministic memory persistence (ADR-009): the harness writes messages + reasoning to NAMS after
 * eve durably records each event — NOT a model-invoked tool. So D3 is a runtime guarantee. userId is
 * server-bound from the session auth (R4); conversationId is the mapped NAMS conversation (§10.6).
 */
function userIdOf(ctx: HookContext): string | null {
  return ctx.session?.auth?.current?.principalId ?? null;
}

async function persist(ctx: HookContext, role: 'user' | 'assistant', content: string) {
  const userId = userIdOf(ctx);
  if (!userId || !content) return;
  try {
    const conversationId = await getOrCreateConversation(userId, ctx.session.id);
    await memory.addMessages(userId, conversationId, [{ role, content }]);
  } catch (err) {
    console.error(`[persist-turn] ${role} message persist failed (non-fatal):`, (err as Error).message);
  }
}

export default defineHook({
  events: {
    'message.received': (event, ctx) => persist(ctx, 'user', event.data.message),
    'message.completed': (event, ctx) => persist(ctx, 'assistant', event.data.message ?? ''),
    'reasoning.completed': async (event, ctx) => {
      const userId = userIdOf(ctx);
      if (!userId) return;
      try {
        const conversationId = await getOrCreateConversation(userId, ctx.session.id);
        await memory.recordReasoning(userId, { conversationId, summary: event.data.reasoning });
      } catch (err) {
        console.error('[persist-turn] reasoning persist failed (non-fatal):', (err as Error).message);
      }
    },
  },
});
