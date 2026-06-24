import { readGraph } from './neo4j';

/**
 * Resolve a park **code OR name** to a canonical parkCode (R2 §3.1) — exact code match first, then a
 * full-text name lookup — so the ranger can pass either when building or previewing a trip. Shared by
 * `build_itinerary` (persist) and `propose_itinerary` (preview) so name resolution behaves identically.
 */
export async function resolveToParkCode(q: string): Promise<string | null> {
  const rows = await readGraph<{ code: string }>(
    `CALL {
       MATCH (p:Park {parkCode: toLower($q)}) RETURN p.parkCode AS code, 1 AS rank
       UNION
       CALL db.index.fulltext.queryNodes('park_fulltext', $q) YIELD node, score
       RETURN node.parkCode AS code, 2 AS rank ORDER BY score DESC LIMIT 1
     }
     RETURN code ORDER BY rank ASC LIMIT 1`,
    { q },
  );
  return rows[0]?.code ?? null;
}

export interface ResolvedPark {
  code: string;
  name: string;
}

/**
 * Resolve an ordered list of park codes/names to `{code, name}`, preserving visit order, de-duping
 * repeats, and collecting entries that matched nothing. The `name` is the park's `fullName` (matches the
 * `parkName` the itinerary card renders).
 */
export async function resolveParkRefs(entries: string[]): Promise<{ resolved: ResolvedPark[]; unresolved: string[] }> {
  const resolved: ResolvedPark[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const code = await resolveToParkCode(entry);
    if (!code) {
      unresolved.push(entry);
      continue;
    }
    if (seen.has(code)) continue;
    seen.add(code);
    const rows = await readGraph<{ name: string | null }>(
      `MATCH (p:Park {parkCode: $code}) RETURN p.fullName AS name`,
      { code },
    );
    resolved.push({ code, name: rows[0]?.name ?? code });
  }
  return { resolved, unresolved };
}
