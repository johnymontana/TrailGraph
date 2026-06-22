import type { AuthFn } from 'eve/channels/auth';
import { auth } from './auth';

/**
 * Better Auth → Eve identity bridge (Phase 2 item #1). A channel AuthFn that resolves the signed-in
 * Better Auth user from the request cookies and returns a SessionAuthContext whose `principalId` is
 * the userId. Because the browser reaches Eve same-origin (via the withEve rewrite), the session
 * cookie flows here. Tools then read `ctx.session.auth.current.principalId` (lib/agent-ctx.ts).
 */
export function betterAuthAuth(): AuthFn<Request> {
  return async (request) => {
    const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    if (!session?.user) return null; // fall through to the next AuthFn (localDev / oidc)
    return {
      principalId: session.user.id,
      principalType: 'user',
      authenticator: 'better-auth',
      attributes: { email: session.user.email ?? '' },
    };
  };
}
