import { runSync, syncStatus, type Tier } from '../../../lib/sync';
import { syncDataSources } from '../../../lib/datasources';
import { assertCron } from '../../../lib/cron-auth';
import { serverError } from '../../../lib/http';

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

export async function GET(req: Request) {
  const deny = assertCron(req);
  if (deny) return deny;
  const tier = new URL(req.url).searchParams.get('tier') as Tier | null;
  if (!tier) {
    return Response.json({ status: await syncStatus() });
  }
  try {
    const results = await runSync(tier);
    // The §5 data-source adapters (dark-sky, crowds, trail difficulty, reservations) ride the corpus run.
    const dataSources = tier === 'slow' || tier === 'all' ? await syncDataSources().catch(() => null) : undefined;
    // A rate-limited resource pauses (saves a cursor) rather than failing the run — surface which steps
    // still need another window so the caller knows to re-run after the NPS quota resets.
    const paused = results.filter((r) => r.counts.paused).map((r) => r.resource);
    return Response.json({ tier, paused, results, dataSources });
  } catch (err) {
    return serverError('sync', err, { tier });
  }
}
