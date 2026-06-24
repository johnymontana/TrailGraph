import { getUserId } from '../../../lib/session';
import {
  listDigests,
  unreadDigestCount,
  markDigestRead,
  buildDigest,
  getEmailDigest,
  setEmailDigest,
} from '../../../lib/digest';
import { listWatches, deleteWatch } from '../../../lib/watches';

/**
 * In-app inbox (Proactive Ranger, ADR-052) — the always-on surface for digests + watches. GET returns
 * the caller's digests, unread count, watches, and email-opt-in state. POST handles inbox ops
 * (build a digest now, mark read, toggle email, remove a watch). userId server-bound (R4).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [digests, unread, watches, emailDigest] = await Promise.all([
    listDigests(userId),
    unreadDigestCount(userId),
    listWatches(userId),
    getEmailDigest(userId),
  ]);
  return Response.json({ digests, unread, watches, emailDigest });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json()) as { op: 'build' | 'read' | 'emailOptIn' | 'removeWatch'; digestId?: string; value?: boolean; watchId?: string };

  switch (body.op) {
    case 'build': {
      const digest = await buildDigest(userId);
      return Response.json({ digest });
    }
    case 'read': {
      if (!body.digestId) return Response.json({ error: 'digestId required' }, { status: 400 });
      await markDigestRead(userId, body.digestId);
      return Response.json({ ok: true, unread: await unreadDigestCount(userId) });
    }
    case 'emailOptIn': {
      await setEmailDigest(userId, !!body.value);
      return Response.json({ emailDigest: !!body.value });
    }
    case 'removeWatch': {
      if (!body.watchId) return Response.json({ error: 'watchId required' }, { status: 400 });
      await deleteWatch(userId, body.watchId);
      return Response.json({ watches: await listWatches(userId) });
    }
    default:
      return Response.json({ error: 'unknown op' }, { status: 400 });
  }
}
