import type { ToolContext } from 'eve/tools';

/**
 * Server-bound caller identity for agent tools (Phase 2 integration item #1, R4).
 *
 * userId MUST come from the Eve session's authenticated context — NOT from a model-supplied tool
 * input, which the model could spoof. Eve exposes the authenticated caller at
 * `ctx.session.auth.current.principalId` (set by the channel route from the Better Auth session).
 */
export function callerId(ctx: ToolContext): string {
  const id = ctx.session?.auth?.current?.principalId;
  if (!id) {
    throw new Error('Unauthenticated agent session: no principalId on session.auth.current');
  }
  return id;
}

/** Stable per-session conversation id (we map this to the NAMS conversationId, §10.6). */
export function sessionId(ctx: ToolContext): string {
  return ctx.session.id;
}

/**
 * Nullable server-bound principal for NON-tool contexts (the dynamic-instructions resolver, which receives
 * a `DynamicResolveContext`, not a `ToolContext`). Structurally typed so it accepts both; returns null for
 * an anonymous session instead of throwing, so callers can skip injecting a memory block (P1.4).
 */
export function principalIdOrNull(
  ctx: { session?: { auth?: { current?: { principalId?: string | null } | null } | null } | null },
): string | null {
  return ctx.session?.auth?.current?.principalId ?? null;
}
