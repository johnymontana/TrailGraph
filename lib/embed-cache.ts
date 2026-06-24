import { contentHash, embed } from './embeddings';
import { readGraph, writeGraph } from './neo4j';

/**
 * Query-embedding cache (audit C5). Embeddings are deterministic, so a normalized query maps to a
 * stable vector — caching it stops re-billing the AI Gateway for the same search (queries repeat
 * heavily, and /search embedded the same text three times). Two tiers, both already in our stack:
 *  - an in-process LRU (hot set, lives within a warm function instance), and
 *  - a :QueryEmbedding node in the one Neo4j (survives across instances/deploys).
 * Keyed by sha256 of the normalized query. Used by the query paths (vibeSearch/semanticSearch); the
 * sync-time embed() stays uncached + content-hash gated as before.
 */

const LRU_MAX = 500;
const lru = new Map<string, number[]>();

function remember(hash: string, vector: number[]): void {
  lru.set(hash, vector);
  if (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest !== undefined) lru.delete(oldest);
  }
}

/** Normalize so trivially-different phrasings of the same query share a cache entry. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Embed a search query, served from cache when seen before. Returns the 1536-dim vector. */
export async function embedQuery(text: string): Promise<number[]> {
  const hash = contentHash(normalize(text));

  const hot = lru.get(hash);
  if (hot) {
    lru.delete(hash);
    lru.set(hash, hot); // LRU bump
    return hot;
  }

  // Persistent tier — never let a cache read fail the search.
  try {
    const cached = await readGraph<{ vector: number[] }>(
      `MATCH (q:QueryEmbedding {hash: $hash}) RETURN q.vector AS vector`,
      { hash },
    );
    const vector = cached[0]?.vector;
    if (vector?.length) {
      remember(hash, vector);
      return vector;
    }
  } catch {
    /* cache miss-as-error: fall through to a fresh embedding */
  }

  const [vector] = await embed([text]);
  if (vector?.length) {
    remember(hash, vector);
    try {
      await writeGraph(
        `MERGE (q:QueryEmbedding {hash: $hash}) SET q.vector = $vector, q.createdAt = timestamp()`,
        { hash, vector },
      );
    } catch {
      /* best-effort cache write; never fail the search on it */
    }
  }
  return vector ?? [];
}
