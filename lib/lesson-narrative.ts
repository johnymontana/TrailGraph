import { createHash } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { generateText } from './generate';

/**
 * Request-time lesson narrative cache (Ranger School, docs/RANGER_SCHOOL_DESIGN.md §3b — the deferred-from-
 * Phase-2 piece). "Graph as cache" for LLM prose: a short Socratic narrative for a lesson is generated ONCE,
 * content-hash gated, and stored as `(:Lesson)-[:HAS_CONTENT]->(:LessonContent {type:'narrative'})`; the next
 * learner of the same lesson reads the cached node — never re-prompts.
 *
 * Cost discipline: generation is gated behind `GENERATE_NARRATIVES=1` (default off, like DECOMPOSE_LESSONPLANS),
 * so `tutor_step` presents zero-token graph-grounded content by default and only enriches with a cached
 * narrative where one already exists or the flag is on. The hash keys on the lesson's stored source text +
 * a version, so a narrative is regenerated only when the source changes.
 *
 * Anti-hallucination: the model is fed ONLY the lesson's stored title/module/objective and told to derive
 * strictly from them (R6) — the same discipline as the offline decomposition.
 */

const NARRATIVE_VERSION = process.env.NARRATIVE_VERSION || 'v1';
const NARRATIVE_MODEL = process.env.NARRATIVE_MODEL || undefined; // undefined → generate.ts default (agent model)

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export interface LessonNarrative {
  id: string;
  body: string;
  contentHash: string;
  cached: boolean;
}

const SYSTEM =
  'You are a U.S. National Park educator. Write a concise (120-200 word) Socratic narrative that teaches the lesson below, derived STRICTLY from the provided title/module/objective — introduce no facts they do not support. End with one open question that invites the learner to think. Plain prose, no headings.';

/**
 * Return the cached narrative for a lesson, generating it once on a miss/stale-hash IF generation is enabled.
 * Returns null when the lesson doesn't exist, or when there's no cached narrative AND generation is disabled.
 */
export async function getOrGenerateNarrative(lessonId: string): Promise<LessonNarrative | null> {
  const src = await readGraph<{ lessonTitle: string; moduleTitle: string | null; objective: string | null }>(
    `MATCH (l:Lesson {id: $lessonId})
     OPTIONAL MATCH (m:Module)-[:CONTAINS_LESSON]->(l)
     OPTIONAL MATCH (lp:LessonPlan)-[:CONTAINS_MODULE]->(m)
     RETURN l.title AS lessonTitle, m.title AS moduleTitle, lp.objective AS objective`,
    { lessonId },
  );
  if (!src.length) return null;
  const sourceText = `${lessonId}|${src[0].lessonTitle}|${src[0].moduleTitle ?? ''}|${src[0].objective ?? ''}`;
  const hash = sha(`${sourceText}|${NARRATIVE_VERSION}`);
  const contentId = `${lessonId}:content:narrative`;

  // Cache-first: read an existing narrative; return it if the source hasn't changed.
  const cached = await readGraph<{ body: string; contentHash: string }>(
    `MATCH (:Lesson {id: $lessonId})-[:HAS_CONTENT]->(c:LessonContent {type: 'narrative'})
     RETURN c.body AS body, c.contentHash AS contentHash`,
    { lessonId },
  );
  if (cached.length && cached[0].contentHash === hash) {
    return { id: contentId, body: cached[0].body, contentHash: hash, cached: true };
  }

  // Cache miss or stale — generation is opt-in (cost control).
  if (process.env.GENERATE_NARRATIVES !== '1') return null;

  const prompt = [
    `Lesson: ${src[0].lessonTitle}`,
    src[0].moduleTitle ? `Module: ${src[0].moduleTitle}` : null,
    src[0].objective ? `Objective: ${src[0].objective}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const body = (await generateText({ system: SYSTEM, prompt, model: NARRATIVE_MODEL, maxTokens: 600, temperature: 0.4 })).trim();
  if (!body) return null;

  await writeGraph(
    `MATCH (l:Lesson {id: $lessonId})
     MERGE (c:LessonContent {id: $contentId})
       SET c.parentId = $lessonId, c.type = 'narrative', c.body = $body,
           c.contentHash = $hash, c.model = $model, c.generatedAt = datetime()
     MERGE (l)-[:HAS_CONTENT]->(c)`,
    { lessonId, contentId, body, hash, model: NARRATIVE_MODEL ?? 'default' },
  );
  return { id: contentId, body, contentHash: hash, cached: false };
}
