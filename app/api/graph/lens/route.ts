import { graphLens, isGraphLens } from '../../../../lib/queries';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * Relationship-lens feed for /graph (#4): re-draw the park set around shared-topic / shared-activity /
 * nearby / same-person / shared-tour / co-considered. Public read; `graphLens` clamps co_considered's
 * minUsers to the k-anonymity floor. CDN-cached via s-maxage (no in-process unstable_cache — see the
 * analytics route note). Distinct sub-path from the map BFF op-switch.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lens = url.searchParams.get('lens') ?? '';
  if (!isGraphLens(lens)) return Response.json({ error: 'unknown lens' }, { status: 400 });
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    return v == null ? undefined : Number(v);
  };

  const rl = await rateLimit(rlIp(clientIp(req), 'graphlens'), 30, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    const data = await graphLens(lens, { minWeight: num('minWeight'), maxMiles: num('maxMiles'), minUsers: num('minUsers') });
    return Response.json(data, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400' } });
  } catch (err) {
    return serverError('graph-lens', err);
  }
}
