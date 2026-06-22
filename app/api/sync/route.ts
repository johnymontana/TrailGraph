import { runSync, syncStatus, type Tier } from '../../../lib/sync';
import { syncDataSources } from '../../../lib/datasources';

/**
 * Cron-triggered NPS sync (ADR-007). Vercel Cron calls this with the configured Authorization
 * bearer (CRON_SECRET). GET ?tier=slow|fast|all runs that tier (all = slow+fast in one call, for the
 * once-daily Vercel Hobby cron); GET (no tier) returns sync health.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 800; // Fluid Compute; long jobs still park/resume via the workflow

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production'; // allow in dev, require in prod
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tier = new URL(req.url).searchParams.get('tier') as Tier | null;
  if (!tier) {
    return Response.json({ status: await syncStatus() });
  }
  try {
    const results = await runSync(tier);
    // The §5 data-source adapters (dark-sky, crowds, trail difficulty, reservations) ride the corpus run.
    const dataSources = tier === 'slow' || tier === 'all' ? await syncDataSources().catch(() => null) : undefined;
    return Response.json({ tier, results, dataSources });
  } catch (err) {
    return Response.json({ tier, error: (err as Error).message }, { status: 500 });
  }
}
