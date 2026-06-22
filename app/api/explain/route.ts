import { getUserId } from '../../../lib/session';
import { explainRecommendation } from '../../../lib/explain';

/** "Why this?" (D4) — graph-grounded provenance for a recommended park. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parkCode = new URL(req.url).searchParams.get('parkCode');
  if (!parkCode) return Response.json({ error: 'parkCode required' }, { status: 400 });
  return Response.json(await explainRecommendation(userId, parkCode));
}
