import { eveChannel, defaultEveAuth } from 'eve/channels/eve';
import { localDev, vercelOidc } from 'eve/channels/auth';
import { betterAuthAuth } from '../../lib/eve-auth';
import { rateLimit, dailyQuota, rlUser, isClamped, AGENT_PER_MINUTE, AGENT_PER_DAY } from '../../lib/rate-limit';
import { offTopicSteer } from '../../lib/topical';

/**
 * The web/HTTP channel the Next.js app talks to (via the withEve same-origin rewrite).
 *
 * Auth walk (first match wins):
 *  1. betterAuthAuth — a signed-in app user (cookie) → principalId = userId (R4).
 *  2. localDev       — open on localhost for `eve dev` + the REPL/TUI (ignored in prod).
 *  3. vercelOidc     — the Eve TUI and Vercel deployments.
 *
 * Deterministic message/reasoning persistence (ADR-009) lives in agent/hooks/persist-turn.ts.
 *
 * Cost ceiling (audit C1/C2): onMessage meters real (Better Auth) users before dispatch — a
 * per-minute burst limit + a per-day turn quota + the runaway clamp from turn-accounting.ts. Over
 * limit ⇒ return null, which accepts the message WITHOUT running a (billed) model turn. The dev/OIDC
 * principals are left unmetered. /api/usage exposes the remaining quota so the chat UI can surface it.
 */
export default eveChannel({
  auth: [betterAuthAuth(), localDev(), vercelOidc()],
  async onMessage(ctx, message) {
    const caller = ctx.eve.caller;
    if (caller?.authenticator === 'better-auth' && caller.principalId) {
      const id = caller.principalId;
      const [clamped, perMin, perDay] = await Promise.all([
        isClamped(id),
        rateLimit(rlUser(id), AGENT_PER_MINUTE, 60),
        dailyQuota(rlUser(id, 'agent:day'), AGENT_PER_DAY),
      ]);
      if (clamped || !perMin.ok || !perDay.ok) {
        console.warn(
          `[agent-ratelimit] dropped turn principal=${id} clamped=${clamped} perMin=${perMin.ok} perDay=${perDay.ok}`,
        );
        return null; // accept without dispatching — no LLM/tool cost
      }
    }
    // Conservative off-topic nudge (C4): inject a steering context for code-proxy-shaped prompts so the
    // model gives a one-line redirect instead of producing the artifact. Does not block.
    const steer = offTopicSteer(message);
    return { auth: defaultEveAuth(ctx), context: steer ? [steer] : undefined };
  },
});
