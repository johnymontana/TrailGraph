import { defineHook } from 'eve/hooks';
import type { HookContext } from 'eve/hooks';
import { tripRunaway } from '../../lib/rate-limit';

/**
 * Per-turn tool-call accounting (audit C2). Eve 0.12 has no first-class per-turn step cap, and hooks
 * are observe-only — they fire after each event is durably recorded and cannot abort an in-flight turn.
 * So the best available defense is to *count* tool calls per turn and, if one turn goes runaway, clamp
 * the user forward: tripRunaway() flags them so the channel onMessage rejects their next message for a
 * while. This bounds a pathological turn at "this turn + clamp," instead of an unbounded loop.
 *
 * (File an Eve feature request for a native maxSteps/stopWhen to make this a hard, in-turn cap.)
 */
const MAX_TOOL_CALLS_PER_TURN = 40;
// Defensive cap on tracked turns: turn.completed/failed normally clears each entry, but if one never
// fires (dropped connection, crash) the entry would leak. Bounding the Map (oldest-evicted on
// turn.started) keeps memory bounded regardless. Maps preserve insertion order, so key(0) is oldest.
const MAX_TRACKED_TURNS = 500;

// turnId → tool-call count for the in-flight turn. Cleared on turn.completed/failed.
const perTurn = new Map<string, number>();

function principalOf(ctx: HookContext): string | null {
  return ctx.session?.auth?.current?.principalId ?? null;
}

export default defineHook({
  events: {
    'turn.started': (event) => {
      // Evict the oldest tracked turn if we're at the cap, so a turn that never completes can't leak.
      if (perTurn.size >= MAX_TRACKED_TURNS) {
        const oldest = perTurn.keys().next().value;
        if (oldest !== undefined) perTurn.delete(oldest);
      }
      perTurn.set(event.data.turnId, 0);
    },
    'action.result': async (event, ctx) => {
      const { turnId } = event.data;
      const n = (perTurn.get(turnId) ?? 0) + 1;
      perTurn.set(turnId, n);
      // Fire exactly once, at the threshold, so we don't write the clamp on every subsequent call.
      if (n === MAX_TOOL_CALLS_PER_TURN) {
        const userId = principalOf(ctx);
        console.warn(
          `[turn-accounting] runaway turn ${turnId} hit ${n} tool calls; clamping principal=${userId ?? 'unknown'}`,
        );
        if (userId) {
          try {
            await tripRunaway(userId);
          } catch (err) {
            console.error('[turn-accounting] clamp write failed (non-fatal):', (err as Error).message);
          }
        }
      }
    },
    'turn.completed': (event) => {
      perTurn.delete(event.data.turnId);
    },
    'turn.failed': (event) => {
      perTurn.delete(event.data.turnId);
    },
  },
});
