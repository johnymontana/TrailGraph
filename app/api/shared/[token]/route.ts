import { getSharedTrip } from '../../../../lib/share';

/** Public, token-scoped read of a shared trip (C6). No auth — the token is the capability. */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await getSharedTrip(token);
  if (!shared) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(shared);
}
