/**
 * Generic 500 response that scrubs internals (audit S8). Logs the real error server-side and returns a
 * generic message — never surface `(err as Error).message` (Neo4j/driver internals, stack hints) to a
 * client. `extra` merges extra fields into the JSON body (e.g. `{ tier }` for the sync route).
 */
export function serverError(context: string, err: unknown, extra?: Record<string, unknown>): Response {
  console.error(`[${context}]`, err);
  return Response.json({ ...extra, error: 'Internal server error' }, { status: 500 });
}
