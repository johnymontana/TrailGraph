import { runSync, syncStatus, type Tier } from '../../../lib/sync';
import { syncDataSources } from '../../../lib/datasources';

/**
 * Cron-triggered NPS sync (ADR-007). Vercel Cron calls this with the configured Authorization
 * bearer (CRON_SECRET). GET ?tier=slow|fast|all runs that tier (all = slow+fast in one call, for the
 * once-daily Vercel Hobby cron); GET (no tier) returns sync health.
 */
export const dynamic = 'force-dynamic';
// Hobby caps Serverless Functions at 300s. The sync steps run as a Vercel Workflow ('use workflow' in
// lib/sync), so long jobs checkpoint and park/resume across invocations rather than needing one long
// function. Raise this on Pro (up to 800 with Fluid Compute) if you want fewer resumes.
export const maxDuration = 300;

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
