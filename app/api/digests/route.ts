import { Resend } from 'resend';
import { usersWithWatches } from '../../../lib/watches';
import { buildDigest } from '../../../lib/digest';
import { digestEmailHtml } from '../../../lib/digest-email';

/**
 * Proactive Ranger digest cron (ADR-052). Vercel Cron calls this daily with the CRON_SECRET bearer; it
 * fans out over every user with ≥1 watch, builds (and persists) their in-app digest, and — only for
 * users who explicitly opted in (default OFF) — emails it via Resend with a one-click unsubscribe.
 * Mirrors the /api/sync auth + maxDuration pattern.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const baseUrl = process.env.BETTER_AUTH_URL ?? 'https://trailgraph.app';
  const users = await usersWithWatches();
  let built = 0;
  let emailed = 0;

  for (const u of users) {
    const digest = await buildDigest(u.userId);
    if (!digest.items.length) continue;
    built++;
    if (u.emailDigest && u.email && u.unsubToken && resend) {
      const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(u.unsubToken)}`;
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM ?? 'TrailGraph <ranger@trailgraph.app>',
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

  return Response.json({ users: users.length, built, emailed });
}
