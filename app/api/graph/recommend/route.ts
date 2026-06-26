import { forYouFromNode } from '../../../../lib/recommend';
import { recsToGraph } from '../../../../lib/graph-nvl';
import { getUserId } from '../../../../lib/session';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * "Recommend from here" feed for /graph (#9): 2-hop, novelty-aware recommendations seeded by ONE park,
 * returned as a result subgraph (the same {narration, nodes, links} shape as ask-the-graph / paths / ego)
 * so the constellation can swap it into the override view. Signed-in only (it reads the user's PREFERS +
 * travel constraints); `from` is decoded (prod URL-encodes params). Distinct sub-path from the map BFF.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const from = new URL(req.url).searchParams.get('from');
  if (!from) return Response.json({ error: 'from required' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graph-recommend'), 30, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    const parkCode = decodeURIComponent(from);
    const { seedName, parks } = await forYouFromNode(userId, parkCode, { limit: 8 });
    return Response.json(recsToGraph({ parkCode, name: seedName }, parks));
  } catch (err) {
    return serverError('graph-recommend', err);
  }
}
