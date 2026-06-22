import { getUserId } from '../../../lib/session';
import { travelersAlsoLoved, setCollectiveOptIn, getCollectiveOptIn } from '../../../lib/collective';

/** Opt-in collective intelligence (E5). Anonymized; only opted-in users get results. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({
    optIn: await getCollectiveOptIn(userId),
    picks: await travelersAlsoLoved(userId),
  });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { optIn } = (await req.json()) as { optIn: boolean };
  await setCollectiveOptIn(userId, !!optIn);
  return Response.json({ optIn: !!optIn, picks: await travelersAlsoLoved(userId) });
}
