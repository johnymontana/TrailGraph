import { shortestPathBetween, type PathMode } from '../../../../lib/graph-query';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * Pathfinding feed for the /graph Path mode (#6): shortest path between two parks, `mode=topical`
 * (built-in, default) or `mode=driving` (weighted GDS Dijkstra over `parks-near`, falls back to topical).
 * `a`/`b` are parkCodes (decoded). Distinct sub-path from the map BFF op-switch.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const a = url.searchParams.get('a');
  const b = url.searchParams.get('b');
  const mode: PathMode = url.searchParams.get('mode') === 'driving' ? 'driving' : 'topical';
  if (!a || !b) return Response.json({ error: 'a and b park codes required' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graphpath'), 20, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    return Response.json(await shortestPathBetween(decodeURIComponent(a), decodeURIComponent(b), mode));
  } catch (err) {
    return serverError('graph-path', err);
  }
}
