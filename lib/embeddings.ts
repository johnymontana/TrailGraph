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

/** Embedding document for a Place (POI) — title + body + tags (NPS-expansion vector search). */
export function composePlaceText(p: { title?: string; bodyText?: string; tags?: string[] }): string {
  return [p.title, p.bodyText, (p.tags ?? []).join(', ')].filter(Boolean).join('\n');
}

/** Embedding document for a Person (historical figure) — title + body + tags. */
export function composePersonText(p: { title?: string; bodyText?: string; tags?: string[] }): string {
  return [p.title, p.bodyText, (p.tags ?? []).join(', ')].filter(Boolean).join('\n');
}

/** Embedding document for an Article — title + listing description + full body (F8). Body is the rich
 * content semantic search should match; `clampForEmbedding` guards against over-long bodies. */
export function composeArticleText(a: { title?: string; description?: string; body?: string }): string {
  return [a.title, a.description, a.body].filter(Boolean).join('\n');
}

/**
 * Embedding models cap input length (text-embedding-3-small: 8192 tokens). Some `:Place` bodies far
 * exceed that, so we clamp by characters as a tokenizer-free guard before sending. ~12k chars is well
 * under 8192 tokens even for dense English+markup (~2–4 chars/token), and the leading text carries the
 * semantic gist a search needs. Deterministic, so content-hash gating stays stable.
 */
export const MAX_EMBED_CHARS = 12000;
export function clampForEmbedding(text: string): string {
  return text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${GATEWAY_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.models.aiGatewayKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: env.models.embedding, input: texts.map(clampForEmbedding) }),
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
