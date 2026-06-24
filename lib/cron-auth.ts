import { timingSafeEqual } from 'node:crypto';

/**
 * Cron authorization, fail-CLOSED (audit S2/S3). Vercel Cron calls the scheduled routes with
 * `Authorization: Bearer ${CRON_SECRET}`. Returns a 401 Response to short-circuit the handler, or
 * `null` when the request is authorized.
 *
 * Replaces three divergent per-route guards that ran the job when CRON_SECRET was UNSET (fail-open in
 * dev / on reconcile) and compared the bearer with `===`. Here: no secret ⇒ nobody runs the job, and
 * the compare is constant-time. CRON_SECRET must be set in EVERY environment (incl. preview) — see
 * .env.example.
 */
export function assertCron(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized(); // fail CLOSED
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return unauthorized();
  return null;
}

function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
