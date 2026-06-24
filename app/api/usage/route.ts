import { getUserId } from '../../../lib/session';
import { peekRateLimit, rlUser, AGENT_PER_DAY } from '../../../lib/rate-limit';

/**
 * Per-user agent usage (audit C1). Lets the chat UI surface today's remaining ranger turns and when
 * the quota resets, so a rate-limited turn (dropped by agent/channels/eve.ts) reads as a clear cap
 * rather than a silent no-response. Read-only peek — does not count a hit.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const day = await peekRateLimit(rlUser(userId, 'agent:day'), AGENT_PER_DAY, 86_400);
  return Response.json({
    agent: { limit: AGENT_PER_DAY, remaining: day.remaining, resetAt: day.resetAt },
  });
}
