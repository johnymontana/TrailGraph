import { eveChannel } from 'eve/channels/eve';
import { localDev, vercelOidc } from 'eve/channels/auth';
import { betterAuthAuth } from '../../lib/eve-auth';

/**
 * The web/HTTP channel the Next.js app talks to (via the withEve same-origin rewrite).
 *
 * Auth walk (first match wins):
 *  1. betterAuthAuth — a signed-in app user (cookie) → principalId = userId (R4).
 *  2. localDev       — open on localhost for `eve dev` + the REPL/TUI (ignored in prod).
 *  3. vercelOidc     — the Eve TUI and Vercel deployments.
 *
 * Deterministic message/reasoning persistence (ADR-009) lives in agent/hooks/persist-turn.ts.
 */
export default eveChannel({
  auth: [betterAuthAuth(), localDev(), vercelOidc()],
});
