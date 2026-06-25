/**
 * Targeted Ranger School backfill: fetch NPS lesson plans (enriched fields), upsert them, derive the
 * CAN_USE_MEDIA joins, and — when DECOMPOSE_LESSONPLANS=1 — decompose into the cached Module/Lesson/
 * QuizQuestion spine. Runs the lib functions DIRECTLY (not via the Vercel Workflow sync) so it works
 * under plain tsx without the workflow runtime. Idempotent + content-hash gated, so it's re-runnable.
 *
 * Usage:  pnpm tsx scripts/backfill-lessonplans.ts [upsertLimit] [decomposeLimit]
 *   upsertLimit    = how many lesson plans to upsert (the catalog); 0 = all. Default 0.
 *   decomposeLimit = how many CHANGED lesson plans to decompose this run (cost cap); 0 = all. Default 25.
 * The full 1357-lesson decompose (~hours, ~$50-70) is better run by the deployed cron (checkpointed/resumable).
 */
import '../lib/load-env';
import { fetchAll, type NpsLessonPlan } from '../lib/nps';
import { upsertLessonPlans } from '../lib/sync/upserts';
import { deriveLessonJoins } from '../lib/sync/derive-lesson-joins';
import { decomposeLessons } from '../lib/sync/decompose-lessons';
import { readGraph, closeDriver } from '../lib/neo4j';

const LESSONPLAN_FIELDS = ['questionObjective', 'commonCore', 'parks', 'duration'];

async function main() {
  const upsertLimit = Number(process.argv[2] ?? 0);
  const decomposeLimit = Number(process.argv[3] ?? 25);
  console.log(`[backfill] fetching lessonplans from NPS…`);
  const all = await fetchAll<NpsLessonPlan>('lessonplans', { fields: LESSONPLAN_FIELDS });
  console.log(`[backfill] NPS returned ${all.length} lesson plans`);

  const subset = upsertLimit > 0 ? all.slice(0, upsertLimit) : all;
  const upserted = await upsertLessonPlans(subset);
  console.log(`[backfill] upserted ${upserted} lesson plans (catalog cap=${upsertLimit || 'all'})`);

  const joins = await deriveLessonJoins();
  console.log(`[backfill] deriveLessonJoins → ${joins.edges} CAN_USE_MEDIA edges`);

  if (process.env.DECOMPOSE_LESSONPLANS === '1') {
    console.log(`[backfill] decomposing up to ${decomposeLimit || 'all'} changed lesson plans (one model call each)…`);
    const dec = await decomposeLessons(decomposeLimit > 0 ? decomposeLimit : undefined);
    console.log(`[backfill] decompose →`, dec);

    const sample = await readGraph(
      `MATCH (lp:LessonPlan)-[:CONTAINS_MODULE]->(m:Module)-[:CONTAINS_LESSON]->(l:Lesson)-[:HAS_QUESTION]->(q:QuizQuestion)
       WITH lp, count(DISTINCT m) AS modules, count(DISTINCT l) AS lessons, count(DISTINCT q) AS quizzes,
            collect({stem: q.stem, correctId: q.correctId, choices: q.choices})[0] AS sampleQuiz
       RETURN lp.id AS id, lp.title AS title, modules, lessons, quizzes, sampleQuiz
       ORDER BY quizzes DESC LIMIT 1`,
    );
    console.log(`[backfill] sample generated course:\n`, JSON.stringify(sample[0] ?? null, null, 2));
  } else {
    console.log(`[backfill] DECOMPOSE_LESSONPLANS not set — skipped decompose`);
  }

  await closeDriver();
  console.log(`[backfill] done.`);
}

main().catch((err) => {
  console.error('[backfill] FAILED:', (err as Error).message);
  process.exit(1);
});
