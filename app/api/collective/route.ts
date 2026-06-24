import { getUserId } from '../../../lib/session';
import { travelersAlsoLoved, setCollectiveOptIn, getCollectiveOptIn } from '../../../lib/collective';
import { skyLeaderboard } from '../../../lib/readings';
import { crowdCurve } from '../../../lib/queries';
import { getUserMemory } from '../../../lib/memory-graph';

/** Opt-in collective intelligence (E5 + v2 ADR-053). Anonymized; only opted-in users get peer picks. */
export const dynamic = 'force-dynamic';

/** Normalized crowd curves for up to 4 of the user's considered parks ("when is my wishlist quietest?"). */
async function consideredCurves(userId: string) {
  const memory = await getUserMemory(userId);
  const codes = memory.considered.slice(0, 4).map((c) => c.parkCode);
  const curves = await Promise.all(codes.map((c) => crowdCurve(c)));
  return curves.filter((c): c is NonNullable<typeof c> => c != null);
}

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  // The SQM leaderboard is public aggregate (anonymized); picks + curves are personal.
  const [optIn, picks, leaderboard, crowdCurves] = await Promise.all([
    getCollectiveOptIn(userId),
    travelersAlsoLoved(userId),
    skyLeaderboard(),
    consideredCurves(userId),
  ]);
  return Response.json({ optIn, picks, leaderboard, crowdCurves });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { optIn } = (await req.json()) as { optIn: boolean };
  await setCollectiveOptIn(userId, !!optIn);
  return Response.json({ optIn: !!optIn, picks: await travelersAlsoLoved(userId) });
}
