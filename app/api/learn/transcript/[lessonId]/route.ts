import { getUserId } from '../../../../../lib/session';
import { getTutorTranscript, saveTutorTranscript } from '../../../../../lib/learn-transcript';

/**
 * Per-lesson tutor transcript: GET returns the saved Eve event stream + session cursor for the lesson player
 * to rehydrate the chat (with cards) on reload; POST upserts it after each tutor turn. userId is server-bound
 * from the Better Auth session (never a client id, R4). Lesson ids contain ':' which arrives URL-encoded in
 * prod builds — decode before keying the graph (the documented dynamic-param gotcha).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const userId = await getUserId(req);
  const { lessonId: raw } = await params;
  const lessonId = decodeURIComponent(raw);
  if (!userId) return Response.json({ events: [], session: null });
  return Response.json(await getTutorTranscript(userId, lessonId));
}

export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const userId = await getUserId(req);
  const { lessonId: raw } = await params;
  const lessonId = decodeURIComponent(raw);
  if (!userId) return Response.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { events?: unknown[]; session?: unknown };
  await saveTutorTranscript(userId, lessonId, { events: body.events ?? [], session: body.session ?? null });
  return Response.json({ ok: true });
}
