import { getUserId } from '../../../lib/session';
import { considerPark } from '../../../lib/bridges';

/** Record that the signed-in user viewed a park → a CONSIDERED memory signal (§5). No-op when anon. */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ ok: false }); // anonymous — nothing to record, not an error
  const { parkCode, source } = (await req.json().catch(() => ({}))) as { parkCode?: string; source?: string };
  if (!parkCode) return Response.json({ error: 'parkCode required' }, { status: 400 });
  await considerPark(userId, parkCode, source === 'saved' ? 'saved' : 'viewed').catch(() => {});
  return Response.json({ ok: true });
}
