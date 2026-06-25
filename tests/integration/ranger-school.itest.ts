import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph, readGraph } from '../../lib/neo4j';
import {
  enrollIn,
  completeLesson,
  recordQuizAttempt,
  recordMastery,
  recordStruggle,
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
  searchCourses,
  crossParkTopics,
  learningTrailForTopic,
} from '../../lib/learn-queries';
import { reconcileUserLearning } from '../../lib/reconcile-memory';
import { deriveLessonTopics } from '../../lib/sync/derive-lesson-topics';
import { awardEarnedBadges } from '../../lib/learn-badges';
import { getTutorTranscript, saveTutorTranscript } from '../../lib/learn-transcript';

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
       OPTIONAL MATCH (u)-[:HAS_TRANSCRIPT]->(tt:TutorTranscript)
       DETACH DELETE u, c, d, tt`,
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

  it('tutor transcript round-trips per (user, lesson) and overwrites on re-save', async () => {
    expect(await getTutorTranscript(userId, LESSON)).toEqual({ events: [], session: null });

    const events = [{ type: 'message.received', data: { message: 'Quiz me on this lesson' } }];
    await saveTutorTranscript(userId, LESSON, { events, session: { sessionId: 'eve:abc' } });
    const loaded = await getTutorTranscript(userId, LESSON);
    expect(loaded.events).toEqual(events);
    expect(loaded.session).toEqual({ sessionId: 'eve:abc' });

    // A second save overwrites in place (MERGE on the composite id) — no duplicate node.
    await saveTutorTranscript(userId, LESSON, { events: [{ type: 'x' }], session: null });
    expect((await getTutorTranscript(userId, LESSON)).events).toEqual([{ type: 'x' }]);
    const count = await readGraph<{ n: number }>(
      `MATCH (:User {userId: $userId})-[:HAS_TRANSCRIPT]->(t:TutorTranscript) RETURN count(t) AS n`,
      { userId },
    );
    expect(count[0].n).toBe(1);
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

  it('Phase 6: awardEarnedBadges grants milestone badges (explorer + cadet + ranger) and is idempotent', async () => {
    // By now this user has enrolled (test 1), completed a lesson (test 1), and issued a certificate (above).
    const newly = await awardEarnedBadges(userId);
    expect(newly).toEqual(expect.arrayContaining(['explorer', 'ranger'])); // cadet was earned directly earlier
    const mem = await getLearningMemory(userId);
    expect(mem.badges.map((b) => b.id)).toEqual(expect.arrayContaining(['explorer', 'cadet', 'ranger']));
    // certificates carry the course title for the /me learning summary
    expect(mem.certificates.find((c) => c.lessonPlanId === LP)?.courseTitle).toBe('Geology of Yellowstone');
    expect(await awardEarnedBadges(userId)).toEqual([]); // idempotent — nothing new on a re-run
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
    // anti-cheat: the client payload must never carry the answer key.
    expect((client as unknown as Record<string, unknown>).correctId).toBeUndefined();
    // choices expose only id + label — no per-choice "correct" flag leaks the answer. (A substring scan
    // for the correctId value can't work: it's also a visible choice id like "hotspot".)
    for (const ch of client!.choices) {
      expect(Object.keys(ch).sort()).toEqual(['id', 'label']);
    }

    const grade = await quizGradeData(QUIZ);
    expect(grade!.correctId).toBe('hotspot');
    expect(grade!.topics).toContain('Volcanoes');

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

  it('Phase 5: searchCourses fulltext finds the seeded course; empty query falls back to the catalog', async () => {
    const hits = await searchCourses('geology');
    expect(hits.some((c) => c.id === LP)).toBe(true);
    // a no-match query returns nothing (not an error)
    expect(await searchCourses('zzqqxxnomatchterm')).toEqual([]);
    // an empty / punctuation-only query falls back to the full catalog
    const fallback = await searchCourses('   ');
    expect(fallback.some((c) => c.id === LP)).toBe(true);
  });

  it('Phase 6: grade-band filter (the seed course is grade 6-8) on learnCatalog + searchCourses', async () => {
    // 6-8 includes the seeded course; k-2 excludes it.
    expect((await learnCatalog(60, '6-8')).some((c) => c.id === LP)).toBe(true);
    expect((await learnCatalog(60, 'k-2')).some((c) => c.id === LP)).toBe(false);
    expect((await searchCourses('geology', { gradeBand: '6-8' })).some((c) => c.id === LP)).toBe(true);
    expect((await searchCourses('geology', { gradeBand: 'k-2' })).some((c) => c.id === LP)).toBe(false);
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

  it('Phase 7: cross-park trails — Geology spans yell + grca; learningTrailForTopic returns both, grade-ordered', async () => {
    // The seed grounds "Geology of Yellowstone" (yell) and "Geology of the Grand Canyon" (grca) in the
    // same 'Geology' topic, so it surfaces as a cross-park trail (≥2 parks).
    const topics = await crossParkTopics(20);
    const geology = topics.find((t) => t.topic === 'Geology');
    expect(geology).toBeDefined();
    expect(geology!.parkCount).toBeGreaterThanOrEqual(2);
    expect(geology!.courseCount).toBeGreaterThanOrEqual(2);

    const trail = await learningTrailForTopic('Geology');
    const ids = trail.map((c) => c.id);
    expect(ids).toContain('lesson-yell-geology');
    expect(ids).toContain('lesson-grca-geology');
    // Grade-band ordering: the yell course (TARGETS GradeBand 6–8) sorts before grca (no GradeBand → 99).
    const yellIdx = ids.indexOf('lesson-yell-geology');
    const grcaIdx = ids.indexOf('lesson-grca-geology');
    expect(yellIdx).toBeLessThan(grcaIdx);
    // The decomposed yell course reports its lesson count; the grca stub has none.
    const yellCourse = trail.find((c) => c.id === 'lesson-yell-geology')!;
    expect(yellCourse.decomposed).toBe(true);
    expect(yellCourse.lessonCount).toBeGreaterThanOrEqual(1);
    expect(yellCourse.parkName).toContain('Yellowstone');

    // An unknown topic yields an empty trail (page-level notFound()).
    expect(await learningTrailForTopic('NoSuchTopicZZZ')).toEqual([]);
  });

  // Runs LAST: deriveLessonTopics adds 'Geology' to the seeded quiz's TESTS, which would perturb the
  // earlier Volcanoes-specific assertions if it ran first.
  it('Phase 6: deriveLessonTopics grounds the course in its park topic + backfills quiz TESTS edges', async () => {
    // The seed's "Geology of Yellowstone" is ABOUT yell, which HAS_TOPIC Geology — so the title matches.
    const res = await deriveLessonTopics();
    expect(res.linkedPlans).toBeGreaterThanOrEqual(1);
    expect(res.relatesEdges).toBeGreaterThanOrEqual(1);

    const rows = await readGraph<{ relates: boolean; tests: boolean }>(
      `RETURN EXISTS { (:LessonPlan {id:$lp})-[:RELATES_TO_TOPIC]->(:Topic {name:'Geology'}) } AS relates,
              EXISTS { (:QuizQuestion {id:$q})-[:TESTS]->(:Topic {name:'Geology'}) } AS tests`,
      { lp: LP, q: QUIZ },
    );
    expect(rows[0].relates).toBe(true); // lesson plan grounded in its park's Geology topic
    expect(rows[0].tests).toBe(true); // and the quiz's TESTS edge backfilled

    // quizGradeData now surfaces it (alongside the seed's Volcanoes) for mastery tracking.
    const grade = await quizGradeData(QUIZ);
    expect(grade!.topics).toContain('Geology');
  });
});

/**
 * Phase 8 — bridge semantics + read edge-cases, fully ISOLATED from the sequential suite above (its own
 * userId + ad-hoc nodes, cleaned in afterAll). Proves the graph-level invariants that the pure unit tests
 * can't: MERGE-latest cardinality, EWMA blending against a real prior, the masteryByTopic recency window,
 * the difficulty fallback, canonicalize-miss no-ops, idempotent completion, and cross-park single-park
 * exclusion.
 */
const u8 = `test-rs8-${Math.random().toString(36).slice(2, 10)}`;

describeIntegration('Ranger School Phase 8 — bridge semantics + read edge-cases (isolated)', () => {
  beforeAll(async () => {
    await seedTestData();
  });

  afterAll(async () => {
    // Remove the test user + the ad-hoc windowing fixtures (quizzes wq:* + the throwaway topic).
    await writeGraph(
      `MATCH (u:User {userId: $u8}) DETACH DELETE u`,
      { u8 },
    );
    await writeGraph(
      `MATCH (q:QuizQuestion) WHERE q.id STARTS WITH 'wq:' DETACH DELETE q`,
    );
    await writeGraph(`MATCH (t:Topic {id: 'top-windowtest'}) DETACH DELETE t`);
    await closeDriver();
  });

  it('recordQuizAttempt is MERGE-latest: re-answering one quiz keeps ONE edge and increments attempt', async () => {
    await recordQuizAttempt(u8, QUIZ, false, 'glacier'); // attempt 1, wrong
    await recordQuizAttempt(u8, QUIZ, true, 'hotspot'); // attempt 2, right (overwrites)
    const rows = await readGraph<{ edges: number; attempt: number; correct: boolean; score: number }>(
      `MATCH (:User {userId:$u8})-[a:ANSWERED]->(:QuizQuestion {id:$q})
       RETURN count(a) AS edges, a.attempt AS attempt, a.correct AS correct, a.score AS score`,
      { u8, q: QUIZ },
    );
    expect(rows[0].edges).toBe(1); // bounded — never CREATE-per-attempt
    expect(rows[0].attempt).toBe(2);
    expect(rows[0].correct).toBe(true); // latest answer wins
    expect(rows[0].score).toBe(1); // FLOAT 1.0 for a correct answer
  });

  it('recordMastery blends successive samples via EWMA (not a flat overwrite)', async () => {
    const first = await recordMastery(u8, 'Volcanoes', 1.0);
    expect(first).toEqual({ previous: null, score: 1 }); // first observation seeds the sample
    const second = await recordMastery(u8, 'Volcanoes', 0.0);
    expect(second!.previous).toBe(1);
    expect(second!.score).toBeCloseTo(0.7, 6); // 0.3*0 + 0.7*1 — NOT a flat 0
    // and the stored edge reflects the blended score
    const mem = await getLearningMemory(u8);
    expect(mem.mastery.find((m) => m.topic === 'Volcanoes')?.score).toBeCloseTo(0.7, 6);
  });

  it('recordStruggle writes nothing (returns false) for a topic that does not canonicalize', async () => {
    const ok = await recordStruggle(u8, 'ZzzNotARealTopicXyz', 0.9);
    expect(ok).toBe(false);
    const rows = await readGraph<{ n: number }>(
      `MATCH (:User {userId:$u8})-[r:STRUGGLES_WITH]->(:Topic {name:'ZzzNotARealTopicXyz'}) RETURN count(r) AS n`,
      { u8 },
    );
    expect(rows[0].n).toBe(0); // no guessing — no edge to a non-existent topic
  });

  it('completeLesson is idempotent — re-completion updates the score on the single COMPLETED edge', async () => {
    await completeLesson(u8, LESSON, 0.5);
    await completeLesson(u8, LESSON, 0.9);
    const rows = await readGraph<{ edges: number; score: number }>(
      `MATCH (:User {userId:$u8})-[r:COMPLETED]->(:Lesson {id:$l})
       RETURN count(r) AS edges, r.score AS score`,
      { u8, l: LESSON },
    );
    expect(rows[0].edges).toBe(1);
    expect(rows[0].score).toBeCloseTo(0.9, 6); // latest score, not a second edge
  });

  it('issueCertificate returns null for a non-existent lesson plan (no orphan certificate)', async () => {
    const cert = await issueCertificate(u8, 'no-such-lesson-plan', 0.5);
    expect(cert).toBeNull();
    const rows = await readGraph<{ n: number }>(
      `MATCH (c:Certificate {lessonPlanId:'no-such-lesson-plan'}) RETURN count(c) AS n`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('pickQuizForLesson falls back to any quiz when the preferred difficulty is absent', async () => {
    // The seed lesson has only an EASY quiz; asking for HARD must still return it (never strand a learner).
    const hard = await pickQuizForLesson(LESSON, 'hard');
    expect(hard).not.toBeNull();
    expect(hard!.id).toBe(QUIZ);
    expect(hard!.difficulty).toBe('easy'); // the actual stored difficulty, not the requested one
  });

  it('masteryByTopic windows to the most-recent N answers (default 10) and computes a FLOAT ratio', async () => {
    // 12 quizzes on a throwaway topic; the 2 OLDEST answers are wrong, the 10 newest correct. With the
    // default window of 10, only the 10 newest count → mastery 1.0, attempts 10 (the 2 wrong fall outside).
    await writeGraph(
      `MERGE (t:Topic {id:'top-windowtest'}) SET t.name = 'WindowTopic'
       MERGE (u:User {userId:$u8})
       WITH t, u
       UNWIND range(0,11) AS i
       MERGE (q:QuizQuestion {id: 'wq:' + toString(i)})
         SET q.lessonId='wlesson', q.stem='Q', q.choices='[]', q.correctId='a', q.difficulty='easy', q.ordinal=i
       MERGE (q)-[:TESTS]->(t)
       MERGE (u)-[a:ANSWERED]->(q)
         SET a.correct = (i >= 2), a.at = datetime('2026-01-01T00:00:00Z') + duration({seconds: i})`,
      { u8 },
    );
    const m = await masteryByTopic(u8);
    const wt = m.find((x) => x.topic === 'WindowTopic');
    expect(wt).toBeDefined();
    expect(wt!.attempts).toBe(10); // windowed to 10, NOT all 12
    expect(wt!.mastery).toBeCloseTo(1.0, 6); // the newest 10 are all correct (FLOAT, not integer-divided)

    // Scoped to a lesson plan that doesn't contain these quizzes → the topic drops out entirely.
    const scoped = await masteryByTopic(u8, LP);
    expect(scoped.find((x) => x.topic === 'WindowTopic')).toBeUndefined();
  });

  it('crossParkTopics excludes a single-park topic (Volcanoes = yell only) but keeps a 2-park topic (Geology)', async () => {
    const topics = await crossParkTopics(50);
    const names = topics.map((t) => t.topic);
    expect(names).toContain('Geology'); // yell + grca
    expect(names).not.toContain('Volcanoes'); // only the yell lesson relates to it → 1 park, excluded
    // every surfaced topic genuinely spans >= 2 parks
    expect(topics.every((t) => t.parkCount >= 2)).toBe(true);
  });

  it('reconcileUserLearning creates a struggle for a non-tombstoned topic but never resurrects a tombstoned one', async () => {
    // Self-contained: the seed QUIZ TESTS Volcanoes; ALSO ground it in a second topic (Geology) here so we
    // don't depend on the other suite having run deriveLessonTopics. Answer WRONG, dismiss ONLY Volcanoes,
    // then reconcile: it must (a) roll up mastery, (b) recreate the Geology struggle (non-tombstoned), but
    // (c) leave the dismissed Volcanoes struggle gone.
    await writeGraph(
      `MATCH (q:QuizQuestion {id:$q}) MERGE (g:Topic {id:'top-geology'}) ON CREATE SET g.name='Geology'
       MERGE (q)-[:TESTS]->(g)`,
      { q: QUIZ },
    );
    await recordQuizAttempt(u8, QUIZ, false, 'glacier'); // wrong → both topics get a wrongRatio of 1.0
    await deleteStruggle(u8, 'Volcanoes'); // dismiss ONLY Volcanoes (tombstone)
    const res = await reconcileUserLearning(u8);
    expect(res.mastery).toBeGreaterThanOrEqual(1); // mastery rolled up
    expect(res.struggles).toBeGreaterThanOrEqual(1); // at least the non-tombstoned Geology struggle written

    const mem = await getLearningMemory(u8);
    const struggling = mem.struggling.map((s) => s.topic);
    expect(struggling).toContain('Geology'); // freely (re)created — depends on reconcile actually running
    expect(struggling).not.toContain('Volcanoes'); // tombstone held despite the wrong answer
  });
});
