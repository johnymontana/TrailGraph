import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { Resend } from 'resend';
import { neo4jAdapter } from './better-auth-neo4j-adapter';

/**
 * Better Auth — passwordless magic link, persisted in Neo4j (ADR-008).
 * The Better Auth user becomes the `:User` graph node = context-graph anchor.
 */

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const auth = betterAuth({
  database: neo4jAdapter(),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Production uses passwordless magic link only. E2E enables email+password (set E2E_TEST_MODE=1)
  // so Playwright can authenticate deterministically without an email round-trip.
  emailAndPassword: { enabled: process.env.E2E_TEST_MODE === '1' },
  plugins: [
    magicLink({
      async sendMagicLink({ email, url }) {
        if (!resend) {
          // Dev fallback: log the link so local sign-in works without an email provider.
          console.log(`[magic-link] ${email} → ${url}`);
          return;
        }
        await resend.emails.send({
          from: process.env.EMAIL_FROM ?? 'TrailGraph <ranger@trailgraph.app>',
          to: email,
          subject: 'Your TrailGraph sign-in link',
          text: `Tap to sign in to TrailGraph:\n\n${url}\n\nThis link expires shortly and can be used once.`,
        });
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
