import { answerGraphQuery } from '../../../../lib/graph-intents';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';
import { serverError } from '../../../../lib/http';

/**
 * On-page "ask the graph" bar (#5a): NL question → embedding-nearest curated intent → narrated answer +
 * subgraph (or disambiguation chips). No LLM in the page loop (the chat `ask_graph` tool is the full NL
 * path). Embeds the query, so guard length + rate-limit per IP exactly like the map `op=vibe`.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { q?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const q = (body.q ?? '').trim();
  if (q.length < 3) return Response.json({ error: 'q required (min 3 chars)' }, { status: 400 });

  const rl = await rateLimit(rlIp(clientIp(req), 'graphq'), 20, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  try {
    return Response.json(await answerGraphQuery(q));
  } catch (err) {
    return serverError('graph-query', err);
  }
}
