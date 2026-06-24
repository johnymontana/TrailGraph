import { getSharedTrip } from '../../../../lib/share';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';

/** Public, token-scoped read of a shared trip (C6). No auth — the token is the capability. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  // Throttle per IP (S6): the token is unguessable, but the public resolve shouldn't be a free
  // unauthenticated DB-read amplifier.
  const rl = await rateLimit(rlIp(clientIp(req), 'shared'), 60, 60);
  if (!rl.ok) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const { token } = await params;
  const shared = await getSharedTrip(token);
  if (!shared) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(shared);
}
