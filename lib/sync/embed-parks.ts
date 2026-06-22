import { readGraph, writeGraph } from '../neo4j';
import { embed, composeParkText, contentHash } from '../embeddings';

/**
 * Content-hash-gated park embedding (ADR-012/ADR-007). Only re-embeds parks whose composed text
 * changed since last sync, so cost tracks real content churn, not run frequency.
 */
export async function embedParks(batchSize = 50): Promise<{ embedded: number; skipped: number }> {
  'use step';
  const parks = await readGraph<{
    parkCode: string;
    fullName: string;
    designation: string;
    description: string;
    states: string;
    acts: string[];
    topics: string[];
    hash: string | null;
  }>(`
    MATCH (p:Park)
    OPTIONAL MATCH (p)-[:OFFERS]->(a:Activity)
    OPTIONAL MATCH (p)-[:HAS_TOPIC]->(t:Topic)
    WITH p, collect(DISTINCT a.name) AS acts, collect(DISTINCT t.name) AS topics
    RETURN p.parkCode AS parkCode, p.fullName AS fullName, p.designation AS designation,
           p.description AS description, p.states AS states, acts, topics,
           p.embeddingHash AS hash
  `);

  const stale = parks
    .map((p) => {
      const text = composeParkText({
        fullName: p.fullName,
        designation: p.designation,
        description: p.description,
        activityNames: p.acts,
        topicNames: p.topics,
        states: p.states,
      });
      return { parkCode: p.parkCode, text, hash: contentHash(text), prev: p.hash };
    })
    .filter((p) => p.hash !== p.prev);

  let embedded = 0;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    const vectors = await embed(batch.map((b) => b.text));
    await writeGraph(
      `
      UNWIND $rows AS row
      MATCH (p:Park {parkCode: row.parkCode})
      CALL db.create.setNodeVectorProperty(p, 'embedding', row.vector)
      SET p.embeddingHash = row.hash
      `,
      { rows: batch.map((b, k) => ({ parkCode: b.parkCode, vector: vectors[k], hash: b.hash })) },
    );
    embedded += batch.length;
  }

  return { embedded, skipped: parks.length - stale.length };
}
