import { getUserId } from '../../../../../lib/session';
import { createShareLink, listShareLinks, revokeShareLink, type ShareRole } from '../../../../../lib/share';

/** Shareable trip links (C6/F4). Owner-only management. */
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  return Response.json({ links: await listShareLinks(userId, id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const { role } = (await req.json().catch(() => ({}))) as { role?: ShareRole };
  const token = await createShareLink(userId, id, role === 'edit' ? 'edit' : 'read');
  if (!token) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ token, url: `/trips/shared/${token}` }, { status: 201 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return Response.json({ error: 'token required' }, { status: 400 });
  await revokeShareLink(userId, id, token);
  return Response.json({ ok: true });
}
