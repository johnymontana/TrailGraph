import { headers } from 'next/headers';
import { auth } from './auth';

/** Server-side userId from the Better Auth session. The isolation boundary — never trust a client id. */
export async function getUserId(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user?.id ?? null;
}

/** Same, for RSC / Server Components (reads request headers via next/headers). */
export async function getServerUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}
