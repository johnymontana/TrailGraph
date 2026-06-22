import { getUserId } from '../../../../lib/session';
import { getUserMemory } from '../../../../lib/memory-graph';
import { reconcileUser, reconcileAll } from '../../../../lib/reconcile-memory';

/**
 * Memory reconciliation (§2.1/§5).
 *  - POST (authed): reconcile the current user now and return their refreshed memory. Called by /me
 *    so implicit chat preferences land as soon as the user looks.
 *  - POST with CRON_SECRET bearer: reconcile all chatting users (scheduled job).
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) {
    return Response.json(await reconcileAll());
  }
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const result = await reconcileUser(userId);
  return Response.json({ ...result, memory: await getUserMemory(userId) });
}

/** Scheduled reconcile of all chatting users (Vercel Cron sends GET with the CRON_SECRET bearer). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json(await reconcileAll());
}
