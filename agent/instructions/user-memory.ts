import { defineDynamic, defineInstructions } from 'eve/instructions';
import { getUserMemory, type UserMemory } from '../../lib/memory-graph';
import { renderMemoryBlock } from '../../lib/memory-block';
import { principalIdOrNull } from '../../lib/agent-ctx';

/**
 * Deterministic memory recall (P1.4, the read-side sibling of the persist hook). Instead of *hoping* the
 * model calls `recall_user_context` at the top of each turn, we inject the user's core context graph as a
 * system message **every turn**, resolved against the un-spoofable server-bound principal — so the ranger
 * always starts a turn already knowing who it's planning for.
 *
 * Why `turn.started` (not `session.started`): a constraint/preference the user sets via a tool mid-session
 * should be visible on the *next* turn. The markdown is byte-identical while memory is unchanged, so the
 * prompt cache still holds across turns (instructions sit in the cache-sensitive system position — Eve
 * restricts instruction resolvers to session/turn boundaries for exactly this reason). Composes ON TOP of
 * the static `agent/instructions.md` (Eve prepends the root file to `instructions/` sources at discovery).
 *
 * Source of truth is the SAME `getUserMemory` accessor the tools use, so this block and any deep-recall
 * tool never disagree. Compaction handles the always-on cost; anonymous sessions get no block; a read
 * failure is non-fatal (returns null, like persist-turn). The pure rendering lives in `lib/memory-block.ts`.
 */
export default defineDynamic({
  events: {
    'turn.started': async (_event, ctx) => {
      const userId = principalIdOrNull(ctx);
      if (!userId) return null; // anonymous → no memory block

      let m: UserMemory;
      try {
        m = await getUserMemory(userId);
      } catch {
        return null; // non-fatal: never break a turn because memory was briefly unreadable
      }

      const markdown = renderMemoryBlock(m);
      if (!markdown) return null; // brand-new user with no saved memory → nothing to inject
      return defineInstructions({ markdown });
    },
  },
});
