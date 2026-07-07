import { getUserId } from '../../../../lib/session';
import { getPlanTranscript, savePlanTranscript } from '../../../../lib/plan-transcript';

/**
 * The `/plan` ranger-chat transcript (ADR-076 P3.9): GET returns the saved Eve event stream so ChatPanel
 * rehydrates the thread (with cards) on reload; POST upserts it after each turn (ChatPanel's `persistUrl`
 * onFinish). One conversation per user — userId is server-bound from the Better Auth session, never a
 * client id (R4). Anonymous → an empty transcript (the page itself gates on sign-in).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ events: [] });
  return Response.json(await getPlanTranscript(userId));
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { events?: unknown[] };
  await savePlanTranscript(userId, { events: body.events ?? [] });
  return Response.json({ ok: true });
}
