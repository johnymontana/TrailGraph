import { readGraph, writeGraph } from './neo4j';

/**
 * Durable delete / suppression (ADR-016). When a user deletes a remembered fact, we record a
 * tombstone so the async extraction/canonicalization pipeline won't resurrect it. The bridge writer
 * (lib/bridges.ts) checks `isSuppressed` before (re)creating a PREFERS edge.
 *
 * Signature scheme: `pref:<kind>:<name-lowercased>` for a canonicalized preference.
 */
export function preferenceSignature(kind: string, name: string): string {
  return `pref:${kind}:${name.trim().toLowerCase()}`;
}

/**
 * Tombstone signature for a Ranger School learning fact. Namespaced under `learn:` and qualified by a
 * COMPOUND kind (e.g. 'struggle:topic', 'earned:badge') so it can never collide with a preference
 * signature (`pref:…`) or across learning kinds — the documented collision risk once Module/Badge kinds
 * exist (RANGER_SCHOOL_DESIGN.md §5). Mirrors `preferenceSignature`.
 */
export function learningSignature(kind: string, name: string): string {
  return `learn:${kind}:${name.trim().toLowerCase()}`;
}

export async function suppress(userId: string, signature: string): Promise<void> {
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[:SUPPRESSED]->(d:DeletedFact {signature:$signature})
     SET d.at = datetime()`,
    { userId, signature },
  );
}

export async function isSuppressed(userId: string, signature: string): Promise<boolean> {
  const rows = await readGraph<{ ok: boolean }>(
    `RETURN EXISTS {
       MATCH (:User {userId:$userId})-[:SUPPRESSED]->(:DeletedFact {signature:$signature})
     } AS ok`,
    { userId, signature },
  );
  return rows[0]?.ok ?? false;
}
