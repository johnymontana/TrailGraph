import { graphTripPath } from '../../../../lib/graph-query';
import { decodeSeed } from '../../../../lib/graph-handoff';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * "Trip route" feed for plan-from-graph (#10c): the NEAR-shortest route through an ORDERED set of selected
 * parks, returned as a result subgraph ({narration, nodes, links}) so the constellation can swap it into the
 * override view. Pure domain pathfinding (no user data) → public + rate-limited; `codes` is decoded/validated/
 * capped by the shared `decodeSeed` codec. Distinct sub-path from the map BFF op-switch.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const codes = decodeSeed(new URL(req.url).searchParams.get('codes'));
  if (codes.length < 2) return Response.json({ error: 'codes required (≥2 park codes)' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graph-trippath'), 20, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    return Response.json(await graphTripPath(codes));
  } catch (err) {
    return serverError('graph-trippath', err);
  }
}
