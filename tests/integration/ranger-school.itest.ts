import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import {
  enrollIn,
  completeLesson,
  recordQuizAttempt,
  earnBadge,
  issueCertificate,
  deleteStruggle,
} from '../../lib/learning-bridges';
import {
  getLearningMemory,
  getLearnDashboard,
  lessonPlanProgress,
  masteryByTopic,
  quizForClient,
  quizGradeData,
  pickQuizForLesson,
  lessonContent,
  learnCatalog,
  certificateBySlug,
} from '../../lib/learn-queries';
import { reconcileUserLearning } from '../../lib/reconcile-memory';

/**
 * Ranger School Phase 3 — learning bridges + progress/mastery reads, against the seeded
 * lesson-yell-geology spine (Module→Lesson→QuizQuestion, TESTS the 'Volcanoes' topic). Badges come from
 * migration 021 (CI applies it before integration). Each run uses a fresh userId; afterAll removes it.
 */
const LP = 'lesson-yell-geology';
const LESSON = 'lesson-yell-geology:m1:l1';
const QUIZ = 'lesson-yell-geology:m1:l1:quiz_v1:easy';
const userId = `test-rs-${Math.random().toString(36).slice(2, 10)}`;

describeIntegration('Ranger School Phase 3 — learning bridges + reads', () => {
  beforeAll(async () => {
    await seedTestData();
  });

  afterAll(async () => {
    await writeGraph(
      `MATCH (u:User {userId: $userId})
       OPTIONAL MATCH (u)-[:ISSUED]->(c:Certificate)
       OPTIONAL MATCH (u)-[:SUPPRESSED]->(d:DeletedFact)
       DETACH DELETE u, c, d`,
      { userId },
    );
    await closeDriver();
  });

  it('enroll + complete → getLearningMemory / dashboard / lessonPlanProgress reflect it', async () => {
    await enrollIn(userId, LP);
    await completeLesson(userId, LESSON, 1.0);

    const mem = await getLearningMemory(userId);
    expect(mem.enrolled.map((e) => e.id)).toContain(LP);
    expect(mem.completedLessons.map((l) => l.id)).toContain(LESSON);

    const dash = await getLearnDashboard(userId);
    expect(dash.enrolled).toBeGreaterThanOrEqual(1);
    expect(dash.completedLessons).toBeGreaterThanOrEqual(1);

    const prog = await lessonPlanProgress(userId, LP);
    expect(prog).not.toBeNull();
    expect(prog!.total).toBeGreaterThanOrEqual(1);
    expect(prog!.done).toBeGreaterThanOrEqual(1);
    const lesson = prog!.modules.flatMap((m) => m.lessons).find((l) => l.id === LESSON);
    expect(lesson?.completed).toBe(true);
  });

  it('answer wrong + reconcileUserLearning → STRUGGLES_WITH + MASTERY on the quiz topic', async () => {
    await recordQuizAttempt(userId, QUIZ, false, 'glacier');
    const res = await reconcileUserLearning(userId);
    expect(res.struggles).toBeGreaterThanOrEqual(1);
    expect(res.mastery).toBeGreaterThanOrEqual(1);

    const mem = await getLearningMemory(userId);
    expect(mem.struggling.map((s) => s.topic)).toContain('Volcanoes');
    const m = mem.mastery.find((x) => x.topic === 'Volcanoes');
    expect(m).toBeDefined();
    expect(m!.score).toBeGreaterThanOrEqual(0);
    expect(m!.score).toBeLessThanOrEqual(1);

    const mastery = await masteryByTopic(userId, LP);
    expect(mastery.find((x) => x.topic === 'Volcanoes')?.mastery).toBe(0); // one wrong answer → 0 correctness
  });

  it('earnBadge returns true on first award, false after (idempotent EARNED)', async () => {
    expect(await earnBadge(userId, 'cadet')).toBe(true);
    expect(await earnBadge(userId, 'cadet')).toBe(false);
    const mem = await getLearningMemory(userId);
    expect(mem.badges.map((b) => b.id)).toContain('cadet');
  });

  it('issueCertificate is immutable — re-issue returns the same id + shareSlug, unchanged score', async () => {
    const first = await issueCertificate(userId, LP, 0.9);
    expect(first).not.toBeNull();
    expect(first!.shareSlug).toHaveLength(16);
    const second = await issueCertificate(userId, LP, 0.1); // a different score must NOT overwrite
    expect(second!.id).toBe(first!.id);
    expect(second!.shareSlug).toBe(first!.shareSlug);
    expect(second!.score).toBe(first!.score);
  });

  it('deleteStruggle tombstones the topic so reconcile will not resurrect it', async () => {
    await deleteStruggle(userId, 'Volcanoes');
    let mem = await getLearningMemory(userId);
    expect(mem.struggling.map((s) => s.topic)).not.toContain('Volcanoes');

    // The wrong answer is still there, but the tombstone must block recreation.
    await reconcileUserLearning(userId);
    mem = await getLearningMemory(userId);
    expect(mem.struggling.map((s) => s.topic)).not.toContain('Volcanoes');
  });

  it('Phase 4: quizForClient hides correctId; quizGradeData (server-only) exposes it + the TESTS topic', async () => {
    const client = await quizForClient(QUIZ);
    expect(client).not.toBeNull();
    expect(client!.choices.length).toBeGreaterThanOrEqual(2);
    // anti-cheat: the client payload must never carry the answer key
    expect((client as unknown as Record<string, unknown>).correctId).toBeUndefined();
    expect(JSON.stringify(client)).not.toContain('hotspot');

    const grade = await quizGradeData(QUIZ);
    expect(grade!.correctId).toBe('hotspot');
    expect(grade!.topic).toBe('Volcanoes');

    const picked = await pickQuizForLesson(LESSON, 'easy');
    expect(picked!.id).toBe(QUIZ);
  });

  it('Phase 4: lessonContent joins the lesson → module → park media (F6)', async () => {
    const lc = await lessonContent(LESSON);
    expect(lc).not.toBeNull();
    expect(lc!.lesson.id).toBe(LESSON);
    expect(lc!.module.title).toBeTruthy();
    expect(lc!.lessonPlanId).toBe(LP);
    expect(lc!.context?.media.audio.some((a) => a.id === 'audio-yell-oldfaithful')).toBe(true);
  });

  it('Phase 5: learnCatalog lists the seeded course (decomposed-first); certificateBySlug resolves the public slug', async () => {
    const catalog = await learnCatalog(60);
    const course = catalog.find((c) => c.id === LP);
    expect(course).toBeDefined();
    expect(course!.decomposed).toBe(true);
    expect(course!.lessonCount).toBeGreaterThanOrEqual(1);
    expect(course!.parkCode).toBe('yell');

    const cert = await certificateBySlug('test0123456789abcd');
    expect(cert).not.toBeNull();
    expect(cert!.lessonPlanId).toBe(LP);
    expect(cert!.courseTitle).toBe('Geology of Yellowstone');
    expect(typeof cert!.score).toBe('number');
    expect(await certificateBySlug('nope-not-a-real-slug')).toBeNull();
  });

  it('lessonPlanProgress keeps a module with zero lessons (split OPTIONAL MATCH, not dropped)', async () => {
    const planId = `test-rs-emptymod-${userId}`;
    await writeGraph(
      `MERGE (lp:LessonPlan {id: $planId}) SET lp.title = 'Empty Module Plan'
       MERGE (m:Module {id: $planId + ':m1'}) SET m.ordinal = 1, m.title = 'Module With No Lessons'
       MERGE (lp)-[:CONTAINS_MODULE]->(m)`,
      { planId },
    );
    const prog = await lessonPlanProgress(userId, planId);
    expect(prog).not.toBeNull();
    expect(prog!.total).toBe(0);
    expect(prog!.modules).toHaveLength(1); // the empty module survives instead of vanishing
    expect(prog!.modules[0].lessons).toEqual([]);
    await writeGraph(
      `MATCH (lp:LessonPlan {id: $planId}) OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(m:Module) DETACH DELETE lp, m`,
      { planId },
    );
  });
});
