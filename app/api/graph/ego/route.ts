import { egoNetwork, isGraphNodeLabel } from '../../../../lib/queries';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * Ego-network feed for /graph (#3): a node + its one-hop neighbours, for the "find a node → see its
 * neighbourhood" flow. `label` is validated against the closed GRAPH_NODE_KEYS allowlist; `key` is decoded
 * (prod URL-encodes params, and Topic/Place ids carry colons). Distinct sub-path from the map BFF op-switch.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const label = url.searchParams.get('label');
  if (!key || !label) return Response.json({ error: 'key and label required' }, { status: 400 });
  if (!isGraphNodeLabel(label)) return Response.json({ error: 'unknown label' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graph-ego'), 60, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    return Response.json(await egoNetwork(decodeURIComponent(key), label));
  } catch (err) {
    return serverError('graph-ego', err);
  }
}
