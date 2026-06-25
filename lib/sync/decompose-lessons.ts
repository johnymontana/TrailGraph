import { createHash } from 'node:crypto';
import { readGraph, writeGraph } from '../neo4j';
import { generateJson } from '../generate';

/**
 * Offline AI decomposition of NPS lesson plans into the Ranger School courseware spine
 * (`(:LessonPlan)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson)-[:HAS_QUESTION]->(:QuizQuestion)`),
 * cached as graph nodes — docs/RANGER_SCHOOL_DESIGN.md §3. Mirrors the embedding cache (`embed-nodes.ts`):
 * env-gated (`DECOMPOSE_LESSONPLANS=1`), content-hash skip (no per-turn / per-sync regeneration), resumable.
 *
 * Cost discipline (the core rule): a lesson plan whose source text + prompt version is UNCHANGED is skipped
 * BEFORE any model call — generation is the only path that spends tokens. Bump `DECOMPOSE_VERSION` only when
 * the prompt template changes. Runtime tutoring tools then read these cached nodes and grade deterministically
 * against `QuizQuestion.correctId` — zero model tokens at request time.
 *
 * Anti-hallucination: the model is fed ONLY the lesson plan's stored prose and told to derive strictly from
 * it; the quiz rationale must cite the lesson. Quiz IDs are deterministic and difficulty-keyed
 * (`<lessonId>:quiz_<version>:<difficulty>`) so cardinality is capped at one question per (lesson, difficulty).
 *
 * Known limitation: regeneration after a content/version change MERGEs in place on stable ordinal IDs (so user
 * `ANSWERED` progress is never destroyed); if a later generation yields FEWER modules/lessons, the surplus old
 * nodes linger with a stale hash. A future prune step can drop generated nodes that carry no user progress.
 */

const DECOMPOSE_VERSION = process.env.DECOMPOSE_VERSION || 'v1';
const DECOMPOSE_MODEL = process.env.DECOMPOSE_MODEL || undefined; // undefined → generate.ts default (agent model)

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// --- model output shape (validated by buildCourseSpine; never trusted raw) ---
interface GenChoice {
  id?: unknown;
  label?: unknown;
}
interface GenQuiz {
  stem?: unknown;
  choices?: GenChoice[];
  correctId?: unknown;
  rationale?: unknown;
  difficulty?: unknown;
}
interface GenLesson {
  title?: unknown;
  durationMin?: unknown;
  quiz?: GenQuiz | null;
}
interface GenModule {
  title?: unknown;
  summary?: unknown;
  lessons?: GenLesson[];
}
export interface GenCourse {
  modules?: GenModule[];
}

// --- persisted spine shape (deterministic IDs; what we MERGE) ---
export interface SpineQuiz {
  id: string;
  ordinal: number;
  stem: string;
  choices: string; // JSON string, matching the seed/store convention
  correctId: string;
  rationale: string;
  difficulty: string;
  contentHash: string;
}
export interface SpineLesson {
  id: string;
  moduleId: string;
  ordinal: number;
  title: string;
  durationMin: number | null;
  quiz: SpineQuiz[]; // 0-or-1 (FOREACH-friendly)
}
export interface SpineModule {
  id: string;
  ordinal: number;
  title: string;
  summary: string | null;
  contentHash: string;
  lessons: SpineLesson[];
}

const DIFFICULTIES = ['easy', 'medium', 'hard'];

function buildQuiz(q: GenQuiz | null | undefined, lessonId: string, genHash: string, version: string): SpineQuiz | null {
  if (!q || typeof q.stem !== 'string' || !q.stem.trim()) return null;
  const choices = (Array.isArray(q.choices) ? q.choices : []).filter(
    (c): c is { id: string; label: string } => !!c && typeof c.id === 'string' && typeof c.label === 'string' && !!c.label.trim(),
  );
  if (choices.length < 2) return null; // need a real multiple choice
  if (!choices.some((c) => c.id === q.correctId)) return null; // correctId must reference a choice
  const difficulty = typeof q.difficulty === 'string' && DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'medium';
  return {
    id: `${lessonId}:quiz_${version}:${difficulty}`, // difficulty-keyed → caps one quiz per (lesson, difficulty)
    ordinal: 1,
    stem: q.stem.trim(),
    choices: JSON.stringify(choices.map((c) => ({ id: c.id, label: c.label.trim() }))),
    correctId: q.correctId as string,
    rationale: typeof q.rationale === 'string' ? q.rationale.trim() : '',
    difficulty,
    contentHash: genHash,
  };
}

/**
 * Validate + normalize a raw model course into the deterministic spine. Pure (unit-tested): drops malformed
 * modules/lessons/quizzes rather than trusting model output. Returns [] when nothing valid survives.
 */
export function buildCourseSpine(
  course: GenCourse | null | undefined,
  lessonPlanId: string,
  genHash: string,
  version: string = DECOMPOSE_VERSION,
): SpineModule[] {
  const modules: SpineModule[] = [];
  (Array.isArray(course?.modules) ? course.modules : []).forEach((m, i) => {
    if (!m || typeof m.title !== 'string' || !m.title.trim()) return;
    const moduleId = `${lessonPlanId}:m${i + 1}`;
    const lessons: SpineLesson[] = [];
    (Array.isArray(m.lessons) ? m.lessons : []).forEach((l, j) => {
      if (!l || typeof l.title !== 'string' || !l.title.trim()) return;
      const lessonId = `${moduleId}:l${j + 1}`;
      const quiz = buildQuiz(l.quiz, lessonId, genHash, version);
      lessons.push({
        id: lessonId,
        moduleId,
        ordinal: j + 1,
        title: l.title.trim(),
        durationMin: typeof l.durationMin === 'number' && l.durationMin > 0 ? Math.round(l.durationMin) : null,
        quiz: quiz ? [quiz] : [],
      });
    });
    if (!lessons.length) return; // a module with no usable lessons is dropped
    modules.push({
      id: moduleId,
      ordinal: i + 1,
      title: m.title.trim(),
      summary: typeof m.summary === 'string' ? m.summary.trim() : null,
      contentHash: genHash,
      lessons,
    });
  });
  return modules;
}

/** Compose the source text the model decomposes — strictly the lesson plan's stored prose (anti-hallucination). */
function composeLessonSource(lp: {
  title: string | null;
  subject: string | null;
  gradeLevel: string | null;
  objective: string | null;
  standards: string | null;
}): string {
  return [
    lp.title,
    lp.subject ? `Subject: ${lp.subject}` : null,
    lp.gradeLevel ? `Grade level: ${lp.gradeLevel}` : null,
    lp.objective ? `Objective / essential question: ${lp.objective}` : null,
    lp.standards ? `Standards: ${lp.standards}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM = [
  'You are a U.S. National Park education designer building a short, accurate micro-course from ONE NPS lesson plan.',
  'Derive EVERYTHING strictly from the provided lesson text. Do not introduce facts the text does not support.',
  'Produce 1-3 modules; each module has 1-3 lessons; each lesson has exactly one multiple-choice quiz question with 3-4 options.',
  'The quiz rationale must explain the correct answer using only the lesson content.',
  'Output JSON of shape: {"modules":[{"title":string,"summary":string,"lessons":[{"title":string,"durationMin":number,"quiz":{"stem":string,"choices":[{"id":string,"label":string}],"correctId":string,"difficulty":"easy"|"medium"|"hard","rationale":string}}]}]}',
  'choice ids are short slugs like "a","b","c"; correctId must equal one of the choice ids.',
].join('\n');

async function persist(lessonPlanId: string, modules: SpineModule[]): Promise<void> {
  // Spine: MERGE Module → Lesson → (optional) QuizQuestion on deterministic IDs (idempotent, progress-safe).
  await writeGraph(
    `MATCH (lp:LessonPlan {id: $lpId})
     UNWIND $modules AS m
     MERGE (mod:Module {id: m.id})
       SET mod.lessonPlanId = $lpId, mod.ordinal = m.ordinal, mod.title = m.title,
           mod.summary = m.summary, mod.contentHash = m.contentHash, mod.generatedAt = datetime()
     MERGE (lp)-[:CONTAINS_MODULE]->(mod)
     WITH mod, m.lessons AS lessons
     UNWIND lessons AS l
     MERGE (les:Lesson {id: l.id})
       SET les.moduleId = l.moduleId, les.ordinal = l.ordinal, les.title = l.title, les.durationMin = l.durationMin
     MERGE (mod)-[:CONTAINS_LESSON]->(les)
     FOREACH (q IN l.quiz |
       MERGE (qq:QuizQuestion {id: q.id})
         SET qq.lessonId = les.id, qq.ordinal = q.ordinal, qq.stem = q.stem, qq.choices = q.choices,
             qq.correctId = q.correctId, qq.rationale = q.rationale, qq.difficulty = q.difficulty,
             qq.contentHash = q.contentHash, qq.generatedAt = datetime()
       MERGE (les)-[:HAS_QUESTION]->(qq)
     )`,
    { lpId: lessonPlanId, modules },
  );
  // Topic grounding: link every generated quiz to the lesson plan's EXISTING topics (no model-guessed topics).
  await writeGraph(
    `MATCH (lp:LessonPlan {id: $lpId})-[:RELATES_TO_TOPIC]->(t:Topic)
     MATCH (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson)-[:HAS_QUESTION]->(qq:QuizQuestion)
     MERGE (qq)-[:TESTS]->(t)`,
    { lpId: lessonPlanId },
  );
}

interface LessonPlanRow {
  id: string;
  title: string | null;
  subject: string | null;
  gradeLevel: string | null;
  objective: string | null;
  standards: string | null;
  priorHashes: string[];
}

/**
 * Decompose every lesson plan that has changed since last generation. Returns counts:
 * `generated` (decomposed this run), `skipped` (unchanged or too thin to decompose), `failed`
 * (model/parse error — logged, non-fatal, retried next run).
 */
export async function decomposeLessons(limit?: number): Promise<{ generated: number; skipped: number; failed: number }> {
  const rows = await readGraph<LessonPlanRow>(
    `MATCH (lp:LessonPlan)
     OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(m:Module)
     RETURN lp.id AS id, lp.title AS title, lp.subject AS subject, lp.gradeLevel AS gradeLevel,
            lp.objective AS objective, lp.standards AS standards,
            [h IN collect(DISTINCT m.contentHash) WHERE h IS NOT NULL] AS priorHashes`,
  );

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const lp of rows) {
    const source = composeLessonSource(lp);
    if (!source.trim() || !lp.objective) {
      skipped++; // nothing substantive to decompose (no objective/essential question)
      continue;
    }
    const genHash = sha(`${lp.id}|${source}|${DECOMPOSE_VERSION}`);
    if (lp.priorHashes.includes(genHash)) {
      skipped++; // content-hash gate: this version already generated → no model call
      continue;
    }
    let course: GenCourse;
    try {
      course = await generateJson<GenCourse>({
        system: SYSTEM,
        prompt: `Lesson plan:\n${source}`,
        model: DECOMPOSE_MODEL,
        maxTokens: 4096,
      });
    } catch (err) {
      console.warn(`[decompose] ${lp.id}: generation/parse failed — ${(err as Error).message}`);
      failed++;
      continue;
    }
    const modules = buildCourseSpine(course, lp.id, genHash);
    if (!modules.length) {
      console.warn(`[decompose] ${lp.id}: model produced no usable modules`);
      failed++;
      continue;
    }
    await persist(lp.id, modules);
    generated++;
    if (limit && generated >= limit) break; // batch cap for cost-controlled backfills (cron passes none → all)
  }

  return { generated, skipped, failed };
}
