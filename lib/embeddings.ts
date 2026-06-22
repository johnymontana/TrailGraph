import { createHash } from 'node:crypto';
import { env, EMBEDDING_DIM } from './env';

/**
 * Embeddings via Vercel AI Gateway's OpenAI-compatible endpoint (ADR-012).
 * Direct fetch (not the AI SDK helper) keeps us off a fast-moving SDK surface; the gateway's
 * /embeddings contract is stable. Model is config-swappable (EMBEDDING_MODEL); dim is fixed at
 * index-creation time (EMBEDDING_DIM).
 */

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

/** Stable content hash so we only re-embed changed text (ADR-007 cost control). */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Compose the embedding document for a park: fold relationships into the vector (ADR-012). */
export function composeParkText(p: {
  fullName?: string;
  designation?: string;
  description?: string;
  activityNames?: string[];
  topicNames?: string[];
  states?: string;
}): string {
  return [
    p.fullName,
    p.designation,
    p.description,
    (p.activityNames ?? []).join(', '),
    (p.topicNames ?? []).join(', '),
    p.states,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${GATEWAY_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.models.aiGatewayKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: env.models.embedding, input: texts }),
  });
  if (!res.ok) throw new Error(`AI Gateway embeddings ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  const vectors = json.data.map((d) => d.embedding);
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding dim ${v.length} != index dim ${EMBEDDING_DIM}. Check EMBEDDING_MODEL.`,
      );
    }
  }
  return vectors;
}
