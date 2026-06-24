import { unsubscribeByToken } from '../../../lib/digest';

/**
 * One-click email digest unsubscribe (ADR-052) — no login required; keyed by an opaque per-user token
 * embedded in every digest email. Sets emailDigest=false for the matching user.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const ok = await unsubscribeByToken(token);
  const msg = ok
    ? "You're unsubscribed from TrailGraph ranger digest emails. You'll still see them in your in-app inbox."
    : 'This unsubscribe link is invalid or already used.';
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:64px auto;padding:0 24px;color:#1c2b24;">
      <h1 style="color:#2f5e3f;font-size:20px;">${ok ? 'Unsubscribed' : 'Hmm'}</h1>
      <p style="color:#5a6b62;">${msg}</p>
      <p><a href="/me" style="color:#2f5e3f;">Manage your preferences →</a></p>
    </body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
