import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../lib/auth';

// Better Auth mounts all its endpoints (magic-link request/verify, session, sign-out) here.
export const { GET, POST } = toNextJsHandler(auth);
