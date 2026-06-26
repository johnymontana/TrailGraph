import { unifiedNodeSearch } from '../../../../lib/queries';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * Unified node search for the /graph search box (#3): parks + places + people + topics + activities.
 * Embeds the query once (vector reused across the vector searches), so guard length + rate-limit per IP
 * exactly like the map `op=vibe`. Distinct sub-path from the map BFF op-switch.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 3) return Response.json({ error: 'q required (min 3 chars)' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graph-search'), 20, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    return Response.json({ hits: await unifiedNodeSearch(q) });
  } catch (err) {
    return serverError('graph-search', err);
  }
}
