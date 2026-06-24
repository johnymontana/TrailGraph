import { Resend } from 'resend';
import { usersWithWatches } from '../../../lib/watches';
import { buildDigest } from '../../../lib/digest';
import { digestEmailHtml } from '../../../lib/digest-email';
import { assertCron } from '../../../lib/cron-auth';
import { pruneRateBuckets } from '../../../lib/rate-limit';

/**
 * Proactive Ranger digest cron (ADR-052). Vercel Cron calls this daily with the CRON_SECRET bearer; it
 * fans out over every user with ≥1 watch, builds (and persists) their in-app digest, and — only for
 * users who explicitly opted in (default OFF) — emails it via Resend with a one-click unsubscribe.
 * Mirrors the /api/sync auth + maxDuration pattern.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function GET(req: Request) {
  const deny = assertCron(req);
  if (deny) return deny;

  // Piggyback the daily prune of expired rate-limit buckets on this cron (audit C1 housekeeping).
  const pruned = await pruneRateBuckets().catch(() => 0);

  const baseUrl = process.env.BETTER_AUTH_URL ?? 'https://trailgraph.app';
  const emailFrom = process.env.EMAIL_FROM;
  const users = await usersWithWatches();
  let built = 0;
  let emailed = 0;

  for (const u of users) {
    const digest = await buildDigest(u.userId);
    if (!digest.items.length) continue;
    built++;
    if (u.emailDigest && u.email && u.unsubToken && resend && emailFrom) {
      const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(u.unsubToken)}`;
      try {
        await resend.emails.send({
          from: emailFrom,
          to: u.email,
          subject: `Your TrailGraph ranger digest · ${digest.forDate}`,
          html: digestEmailHtml(digest.items, digest.forDate, unsubscribeUrl),
        });
        emailed++;
      } catch {
        // a failed send shouldn't abort the whole fan-out
      }
    }
  }

  return Response.json({ users: users.length, built, emailed, pruned });
}
