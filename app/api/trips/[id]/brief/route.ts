import { getUserId } from '../../../../../lib/session';
import { tripBrief } from '../../../../../lib/trip-lab';
import { tripBriefHtml } from '../../../../../lib/trip-brief-html';

/** Printable field brief for a trip (ADR-057) — a self-contained, no-JS HTML one-pager per stop. */
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const brief = await tripBrief(userId, id);
  if (!brief) return Response.json({ error: 'not found' }, { status: 404 });
  return new Response(tripBriefHtml(brief), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
