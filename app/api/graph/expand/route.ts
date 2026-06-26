import { expandNode, isGraphNodeLabel } from '../../../../lib/queries';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * Expand-on-click feed for the /graph explorer (#2). Distinct sub-path from the map BFF op-switch at
 * `app/api/graph/route.ts` — no collision. Public, read-only, one cheap single-hop read; label is
 * validated against the closed `GRAPH_NODE_KEYS` allowlist and `key` is decoded (prod URL-encodes params).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const label = url.searchParams.get('label');
  if (!key || !label) return Response.json({ error: 'key and label required' }, { status: 400 });
  if (!isGraphNodeLabel(label)) return Response.json({ error: 'unknown label' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graph-expand'), 60, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    const data = await expandNode(decodeURIComponent(key), label);
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=86400' },
    });
  } catch (err) {
    return serverError('graph-expand', err);
  }
}
