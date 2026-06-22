import { readGraph, writeGraph } from '../neo4j';
import { embed, contentHash, composePlaceText, composePersonText, composeArticleText, clampForEmbedding } from '../embeddings';

/**
 * Content-hash-gated embedding for the NPS-expansion nodes (Place/Person/Article), mirroring
 * `embedParks` (ADR-012/007): only re-embed a node whose composed text changed since last sync, so
 * cost tracks real content churn. Each row carries its node `id` AS `key` + prior `embeddingHash` AS
 * `hash`. Resumable by construction — a node embedded once (hash stored) is skipped next run, so an
 * interrupted backfill simply continues with the remaining stale nodes on the next sync.
 */
async function embedLabeledNodes<R extends { key: string; hash: string | null }>(
  label: string,
  query: string,
  compose: (row: R) => string,
  batchSize = 50,
): Promise<{ embedded: number; skipped: number }> {
  const rows = await readGraph<R>(query);
  const stale = rows
    .map((r) => {
      const text = clampForEmbedding(compose(r));
      return { key: r.key, text, hash: contentHash(text), prev: r.hash };
    })
    .filter((r) => r.text.trim().length > 0 && r.hash !== r.prev);

  let embedded = 0;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    const vectors = await embed(batch.map((b) => b.text));
    await writeGraph(
      `
      UNWIND $rows AS row
      MATCH (n:\`${label}\` {id: row.key})
      CALL db.create.setNodeVectorProperty(n, 'embedding', row.vector)
      SET n.embeddingHash = row.hash
      `,
      { rows: batch.map((b, k) => ({ key: b.key, vector: vectors[k], hash: b.hash })) },
    );
    embedded += batch.length;
  }
  return { embedded, skipped: rows.length - stale.length };
}

type TextRow = { key: string; hash: string | null; title: string | null; bodyText: string | null; tags: string[] | null };
type ArticleRow = { key: string; hash: string | null; title: string | null; description: string | null };

export const embedPlaces = (): Promise<{ embedded: number; skipped: number }> =>
  embedLabeledNodes<TextRow>(
    'Place',
    `MATCH (n:Place) RETURN n.id AS key, n.title AS title, n.bodyText AS bodyText, n.tags AS tags, n.embeddingHash AS hash`,
    (r) => composePlaceText({ title: r.title ?? undefined, bodyText: r.bodyText ?? undefined, tags: r.tags ?? undefined }),
  );

export const embedPeople = (): Promise<{ embedded: number; skipped: number }> =>
  embedLabeledNodes<TextRow>(
    'Person',
    `MATCH (n:Person) RETURN n.id AS key, n.title AS title, n.bodyText AS bodyText, n.tags AS tags, n.embeddingHash AS hash`,
    (r) => composePersonText({ title: r.title ?? undefined, bodyText: r.bodyText ?? undefined, tags: r.tags ?? undefined }),
  );

export const embedArticles = (): Promise<{ embedded: number; skipped: number }> =>
  embedLabeledNodes<ArticleRow>(
    'Article',
    `MATCH (n:Article) RETURN n.id AS key, n.title AS title, n.description AS description, n.embeddingHash AS hash`,
    (r) => composeArticleText({ title: r.title ?? undefined, description: r.description ?? undefined }),
  );
