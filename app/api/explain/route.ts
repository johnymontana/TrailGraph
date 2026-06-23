import { getUserId } from '../../../lib/session';
import { explainGraph } from '../../../lib/explain';

/** "Why this park?" (D4 / ADR-047) — the literal explanatory edges for the provenance popover. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parkCode = new URL(req.url).searchParams.get('parkCode');
  if (!parkCode) return Response.json({ error: 'parkCode required' }, { status: 400 });
  return Response.json(await explainGraph(userId, parkCode));
}
