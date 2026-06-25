import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the Ranger School tutor tools (agent/tools/*). `defineTool(def)` returns `def` (+ a brand),
 * so the default export's `execute(input, ctx)` is directly callable. We stub `eve/tools`, identity, and the
 * lib deps so we test each tool's ORCHESTRATION logic (which bridges/reads it calls + the {kind,data} it
 * returns) in isolation — the bridges/reads themselves are integration-tested.
 */
vi.mock('eve/tools', () => ({ defineTool: (def: unknown) => def }));
vi.mock('../../lib/agent-ctx', () => ({ callerId: vi.fn(() => 'u1'), sessionId: vi.fn(() => 's1') }));
vi.mock('../../lib/learning-bridges', () => ({
  recordQuizAttempt: vi.fn(),
  recordMastery: vi.fn(),
  recordStruggle: vi.fn(),
  completeLesson: vi.fn(),
  enrollIn: vi.fn(),
  earnBadge: vi.fn(),
  issueCertificate: vi.fn(),
}));
vi.mock('../../lib/learn-queries', () => ({
  quizGradeData: vi.fn(),
  pickQuizForLesson: vi.fn(),
  masteryByTopic: vi.fn(),
  quizDifficultyForMastery: vi.fn(),
  lessonContent: vi.fn(),
  lessonPlanProgress: vi.fn(),
  getLearningMemory: vi.fn(),
}));
vi.mock('../../lib/queries', () => ({ lessonPlansForPark: vi.fn() }));
vi.mock('../../lib/learn-badges', () => ({ awardEarnedBadges: vi.fn() }));
vi.mock('../../lib/lesson-narrative', () => ({ getOrGenerateNarrative: vi.fn() }));

import * as ctx from '../../lib/agent-ctx';
import * as bridges from '../../lib/learning-bridges';
import * as lq from '../../lib/learn-queries';
import * as queries from '../../lib/queries';
import * as learnBadges from '../../lib/learn-badges';
import * as narrative from '../../lib/lesson-narrative';
import gradeAnswer from '../../agent/tools/grade_answer';
import recommendNext from '../../agent/tools/recommend_next';
import generateQuiz from '../../agent/tools/generate_quiz';
import startLesson from '../../agent/tools/start_lesson';
import recallLearningContext from '../../agent/tools/recall_learning_context';
import tutorStep from '../../agent/tools/tutor_step';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (tool: any, input: unknown) => tool.execute(input, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ctx.callerId).mockReturnValue('u1');
  vi.mocked(learnBadges.awardEarnedBadges).mockResolvedValue([]); // default: no new badges
});

describe('grade_answer', () => {
  beforeEach(() => {
    vi.mocked(lq.quizGradeData).mockResolvedValue({
      correctId: 'a',
      rationale: 'Because the hotspot.',
      difficulty: 'easy',
      lessonId: 'l1',
      topics: ['Geology', 'Volcanoes'],
    });
    vi.mocked(bridges.recordMastery).mockResolvedValue({ previous: null, score: 1 });
  });

  it('grades a CORRECT answer: records attempt + mastery per topic, completes the lesson, no struggle', async () => {
    const out = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'a' });
    expect(out.kind).toBe('quiz_feedback_card');
    expect(out.data.correct).toBe(true);
    expect(out.data.topics).toEqual(['Geology', 'Volcanoes']);
    expect(bridges.recordQuizAttempt).toHaveBeenCalledWith('u1', 'q1', true, 'a');
    expect(bridges.recordMastery).toHaveBeenCalledTimes(2); // one per topic
    expect(bridges.recordMastery).toHaveBeenCalledWith('u1', 'Geology', 1);
    expect(bridges.recordStruggle).not.toHaveBeenCalled();
    expect(bridges.completeLesson).toHaveBeenCalledWith('u1', 'l1', 1);
  });

  it('grades a WRONG answer: mastery 0 + struggle per topic, lesson NOT completed', async () => {
    const out = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'b' });
    expect(out.data.correct).toBe(false);
    expect(bridges.recordMastery).toHaveBeenCalledWith('u1', 'Geology', 0);
    expect(bridges.recordStruggle).toHaveBeenCalledTimes(2);
    expect(bridges.completeLesson).not.toHaveBeenCalled();
  });

  it('handles a topic-less quiz gracefully (no mastery/struggle, still records + completes on correct)', async () => {
    vi.mocked(lq.quizGradeData).mockResolvedValue({ correctId: 'a', rationale: null, difficulty: 'easy', lessonId: 'l1', topics: [] });
    const out = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'a' });
    expect(out.data.correct).toBe(true);
    expect(bridges.recordMastery).not.toHaveBeenCalled();
    expect(bridges.recordStruggle).not.toHaveBeenCalled();
    expect(bridges.completeLesson).toHaveBeenCalledWith('u1', 'l1', 1);
  });

  it('returns an error card when the quiz is missing', async () => {
    vi.mocked(lq.quizGradeData).mockResolvedValue(null);
    const out = await exec(gradeAnswer, { quizId: 'nope', choiceId: 'a' });
    expect(out.kind).toBe('quiz_feedback_card');
    expect(out.data.error).toMatch(/not found/i);
    expect(bridges.recordQuizAttempt).not.toHaveBeenCalled();
  });

  it('surfaces the FIRST topic’s mastery score on the card (not the sample, not later topics)', async () => {
    // recordMastery returns the FIRST topic's score 0.7, then a different 0.95 for the second.
    vi.mocked(bridges.recordMastery)
      .mockResolvedValueOnce({ previous: 0.5, score: 0.7 })
      .mockResolvedValueOnce({ previous: 0.9, score: 0.95 });
    const out = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'a' });
    expect(out.data.mastery).toBe(0.7); // captured once via the `if (mastery === null)` guard
    expect(out.data.mastery).not.toBe(1); // not the recorded sample value
    expect(out.data.mastery).not.toBe(0.95); // not the later topic's score
  });

  it('surfaces earnedBadges on the card and awards badges even on a WRONG answer', async () => {
    vi.mocked(learnBadges.awardEarnedBadges).mockResolvedValue(['cadet']);
    const correctOut = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'a' });
    expect(correctOut.data.earnedBadges).toEqual(['cadet']);
    expect(learnBadges.awardEarnedBadges).toHaveBeenCalledWith('u1');

    vi.clearAllMocks();
    vi.mocked(ctx.callerId).mockReturnValue('u1');
    vi.mocked(lq.quizGradeData).mockResolvedValue({
      correctId: 'a', rationale: 'Because the hotspot.', difficulty: 'easy', lessonId: 'l1', topics: ['Geology', 'Volcanoes'],
    });
    vi.mocked(bridges.recordMastery).mockResolvedValue({ previous: null, score: 0 });
    vi.mocked(learnBadges.awardEarnedBadges).mockResolvedValue(['topic-geology']);
    const wrongOut = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'b' });
    expect(wrongOut.data.correct).toBe(false);
    expect(learnBadges.awardEarnedBadges).toHaveBeenCalledWith('u1'); // line 38 runs unconditionally
    expect(wrongOut.data.earnedBadges).toEqual(['topic-geology']); // topic-mastery badge possible on a miss
  });

  it('reveals correctId + rationale + citationLessonId on the feedback card (post-answer reveal is intended)', async () => {
    const out = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'b' });
    expect(out.data.correctId).toBe('a'); // WITHHELD pre-answer (generate_quiz) but revealed in feedback
    expect(out.data.rationale).toBe('Because the hotspot.');
    expect(out.data.citationLessonId).toBe('l1');
    expect(out.data.topics).toEqual(['Geology', 'Volcanoes']);
  });

  it('leaves mastery null when recordMastery returns null for a non-topic and still completes the lesson', async () => {
    vi.mocked(lq.quizGradeData).mockResolvedValue({ correctId: 'a', rationale: null, difficulty: 'easy', lessonId: 'l1', topics: ['NotATopic'] });
    vi.mocked(bridges.recordMastery).mockResolvedValue(null as never); // canonicalize miss
    const out = await exec(gradeAnswer, { quizId: 'q1', choiceId: 'a' });
    expect(out.data.correct).toBe(true);
    expect(out.data.mastery).toBeNull(); // the `m?.score ?? null` path
    expect(bridges.recordStruggle).not.toHaveBeenCalled();
    expect(bridges.completeLesson).toHaveBeenCalledWith('u1', 'l1', 1);
  });
});

describe('recommend_next', () => {
  beforeEach(() => {
    vi.mocked(lq.lessonContent).mockResolvedValue({
      lesson: { id: 'l1', ordinal: 1, title: 'Lesson 1', durationMin: 10 },
      module: { id: 'm1', ordinal: 1, title: 'Module 1', summary: null },
      lessonPlanId: 'lp1',
      context: null,
    });
  });

  it('ADVANCE: points to the next uncompleted lesson', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Course', done: 1, total: 2,
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [
        { id: 'l1', ordinal: 1, title: 'L1', completed: true },
        { id: 'l2', ordinal: 2, title: 'L2', completed: false },
      ] }],
    });
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.kind).toBe('next_step_card');
    expect(out.data.recommendation).toBe('advance');
    expect(out.data.lessonId).toBe('l2');
    expect(bridges.issueCertificate).not.toHaveBeenCalled();
  });

  it('COMPLETE: issues a certificate + Junior Ranger badge when every lesson is done', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Course', done: 1, total: 1,
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [{ id: 'l1', ordinal: 1, title: 'L1', completed: true }] }],
    });
    vi.mocked(lq.masteryByTopic).mockResolvedValue([{ topic: 'Geology', mastery: 0.9, attempts: 3 }]);
    vi.mocked(bridges.issueCertificate).mockResolvedValue({ id: 'cert1', shareSlug: 'slug123', score: 0.9, issuedAt: '2026-06-25' });
    vi.mocked(learnBadges.awardEarnedBadges).mockResolvedValue(['ranger']);
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.data.recommendation).toBe('complete');
    expect(out.data.certificate.shareSlug).toBe('slug123');
    expect(out.data.earnedBadges).toEqual(['ranger']);
    expect(bridges.issueCertificate).toHaveBeenCalledWith('u1', 'lp1', 0.9); // score = avg mastery
    expect(learnBadges.awardEarnedBadges).toHaveBeenCalledWith('u1');
  });

  it('returns an error card when the lesson is missing', async () => {
    vi.mocked(lq.lessonContent).mockResolvedValue(null);
    const out = await exec(recommendNext, { lessonId: 'nope' });
    expect(out.data.error).toMatch(/not found/i);
  });

  it('COMPLETE with no mastery rows defaults the certificate score to 1', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Course', done: 1, total: 1,
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [{ id: 'l1', ordinal: 1, title: 'L1', completed: true }] }],
    });
    vi.mocked(lq.masteryByTopic).mockResolvedValue([]); // empty → fall back to 1
    vi.mocked(bridges.issueCertificate).mockResolvedValue({ id: 'cert1', shareSlug: 'slug', score: 1, issuedAt: '2026-06-25' });
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.data.recommendation).toBe('complete');
    expect(bridges.issueCertificate).toHaveBeenCalledWith('u1', 'lp1', 1); // `mastery.length ? avg : 1`
  });

  it('REMEDIATE: no uncompleted lesson, course not complete, weakest topic <0.6', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Course', done: 1, total: 2, // not complete, but spine has no uncompleted lesson
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [{ id: 'l1', ordinal: 1, title: 'L1', completed: true }] }],
    });
    vi.mocked(lq.masteryByTopic).mockResolvedValue([
      { topic: 'Geology', mastery: 0.3, attempts: 4 },
      { topic: 'Volcanoes', mastery: 0.5, attempts: 2 },
    ]);
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.data.recommendation).toBe('remediate');
    expect(out.data.topic).toBe('Geology'); // lowest after <0.6 filter + ascending sort
    expect(out.data.reason).toMatch(/Geology/);
    expect(bridges.issueCertificate).not.toHaveBeenCalled();
  });

  it('REMEDIATE branch with no weak topic falls back to advance “Keep going!”', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Course', done: 1, total: 2,
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [{ id: 'l1', ordinal: 1, title: 'L1', completed: true }] }],
    });
    vi.mocked(lq.masteryByTopic).mockResolvedValue([{ topic: 'Geology', mastery: 0.9, attempts: 4 }]); // none <0.6
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.data.recommendation).toBe('advance');
    expect(out.data.topic).toBeNull();
    expect(out.data.reason).toBe('Keep going!');
  });

  it('does NOT mark complete when progress.total is 0 (empty course)', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({ title: 'Course', done: 0, total: 0, modules: [] });
    vi.mocked(lq.masteryByTopic).mockResolvedValue([]);
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.data.recommendation).toBe('advance'); // guard `total > 0 && done >= total` false
    expect(out.data.reason).toBe('Keep going!');
    expect(bridges.issueCertificate).not.toHaveBeenCalled();
  });

  it('returns a Course-not-found error card when progress is null', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue(null);
    const out = await exec(recommendNext, { lessonId: 'l1' });
    expect(out.kind).toBe('next_step_card');
    expect(out.data.error).toMatch(/course not found/i);
    expect(bridges.issueCertificate).not.toHaveBeenCalled();
  });
});

describe('generate_quiz', () => {
  beforeEach(() => {
    vi.mocked(lq.pickQuizForLesson).mockResolvedValue({
      id: 'q1', stem: 'What drives geysers?', choices: [{ id: 'a', label: 'Hotspot' }], difficulty: 'hard', lessonId: 'l1',
    });
  });

  it('emits a quiz_card WITHOUT the correct answer (anti-cheat) and STOPS', async () => {
    vi.mocked(lq.masteryByTopic).mockResolvedValue([]);
    vi.mocked(lq.quizDifficultyForMastery).mockReturnValue('easy');
    const out = await exec(generateQuiz, { lessonId: 'l1' });
    expect(out.kind).toBe('quiz_card');
    expect(out.data.quizId).toBe('q1');
    expect(out.data.stem).toBeTruthy();
    expect(JSON.stringify(out.data)).not.toContain('correctId'); // never shipped
  });

  it('adapts difficulty from the learner mastery (weakest topic → quizDifficultyForMastery)', async () => {
    vi.mocked(lq.masteryByTopic).mockResolvedValue([{ topic: 'A', mastery: 0.9, attempts: 5 }, { topic: 'B', mastery: 0.3, attempts: 2 }]);
    vi.mocked(lq.quizDifficultyForMastery).mockReturnValue('easy');
    await exec(generateQuiz, { lessonId: 'l1' });
    expect(lq.quizDifficultyForMastery).toHaveBeenCalledWith(0.3); // the minimum mastery
    expect(lq.pickQuizForLesson).toHaveBeenCalledWith('l1', 'easy');
  });

  it('honors an explicit difficulty override (skips mastery)', async () => {
    await exec(generateQuiz, { lessonId: 'l1', difficulty: 'medium' });
    expect(lq.masteryByTopic).not.toHaveBeenCalled();
    expect(lq.pickQuizForLesson).toHaveBeenCalledWith('l1', 'medium');
  });

  it('falls back to easy for an anonymous caller (callerId throws)', async () => {
    vi.mocked(ctx.callerId).mockImplementation(() => { throw new Error('unauthenticated'); });
    await exec(generateQuiz, { lessonId: 'l1' });
    expect(lq.pickQuizForLesson).toHaveBeenCalledWith('l1', 'easy');
  });

  it('returns an error card when no quiz exists', async () => {
    vi.mocked(lq.pickQuizForLesson).mockResolvedValue(null);
    const out = await exec(generateQuiz, { lessonId: 'l1', difficulty: 'easy' });
    expect(out.kind).toBe('quiz_card');
    expect(out.data.error).toMatch(/no quiz/i);
  });

  it('happy-path card echoes quizId, stem, choices, the QUIZ difficulty AND the input lessonId', async () => {
    const out = await exec(generateQuiz, { lessonId: 'l1', difficulty: 'easy' });
    expect(out.data.quizId).toBe('q1');
    expect(out.data.stem).toBe('What drives geysers?');
    expect(out.data.choices).toEqual([{ id: 'a', label: 'Hotspot' }]);
    expect(out.data.difficulty).toBe('hard'); // the QUIZ's difficulty (line 33), not the requested 'easy'
    expect(out.data.lessonId).toBe('l1'); // the tool's OWN lessonId arg
  });

  it('passes null mastery to quizDifficultyForMastery for a cold-start authenticated learner', async () => {
    vi.mocked(lq.masteryByTopic).mockResolvedValue([]); // empty mastery
    vi.mocked(lq.quizDifficultyForMastery).mockReturnValue('easy');
    await exec(generateQuiz, { lessonId: 'l1' }); // no difficulty override
    expect(lq.quizDifficultyForMastery).toHaveBeenCalledWith(null); // `mastery.length ? ... : null`
    expect(lq.pickQuizForLesson).toHaveBeenCalledWith('l1', 'easy');
  });
});

describe('start_lesson', () => {
  it('with lessonPlanId: enrolls + returns the module spine', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Geology', done: 0, total: 1,
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [{ id: 'l1', ordinal: 1, title: 'L1', completed: false }] }],
    });
    const out = await exec(startLesson, { lessonPlanId: 'lp1' });
    expect(out.kind).toBe('lesson_card');
    expect(out.data.enrolled).toBe(true);
    expect(out.data.title).toBe('Geology');
    expect(bridges.enrollIn).toHaveBeenCalledWith('u1', 'lp1');
  });

  it('with only a parkCode: lists that park’s courses (no enroll)', async () => {
    vi.mocked(queries.lessonPlansForPark).mockResolvedValue([
      { id: 'lp1', title: 'Geology of Yellowstone', url: null, subject: 'Earth Science', gradeLevel: '6-8', objective: null, durationMin: null, image: null, topics: [] },
    ]);
    const out = await exec(startLesson, { parkCode: 'yell' });
    expect(out.kind).toBe('lesson_card');
    expect(out.data.courses).toHaveLength(1);
    expect(bridges.enrollIn).not.toHaveBeenCalled();
  });

  it('with neither: returns a guidance error card', async () => {
    const out = await exec(startLesson, {});
    expect(out.data.error).toBeTruthy();
  });

  it('with a missing lessonPlanId: returns a not-found card', async () => {
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue(null);
    const out = await exec(startLesson, { lessonPlanId: 'nope' });
    expect(out.data.error).toMatch(/not found/i);
  });

  it('surfaces earnedBadges on the enrolled spine card, enrolling BEFORE awarding', async () => {
    const calls: string[] = [];
    vi.mocked(bridges.enrollIn).mockImplementation(async () => { calls.push('enroll'); });
    vi.mocked(learnBadges.awardEarnedBadges).mockImplementation(async () => { calls.push('award'); return ['explorer']; });
    vi.mocked(lq.lessonPlanProgress).mockResolvedValue({
      title: 'Geology', done: 0, total: 1,
      modules: [{ id: 'm1', ordinal: 1, title: 'M1', lessons: [{ id: 'l1', ordinal: 1, title: 'L1', completed: false }] }],
    });
    const out = await exec(startLesson, { lessonPlanId: 'lp1' });
    expect(out.data.earnedBadges).toEqual(['explorer']);
    expect(calls).toEqual(['enroll', 'award']); // first-enrollment badge ordering
  });

  it('with a parkCode having no courses: returns a “no courses” card and never enrolls', async () => {
    vi.mocked(queries.lessonPlansForPark).mockResolvedValue([]);
    const out = await exec(startLesson, { parkCode: 'zion' });
    expect(out.kind).toBe('lesson_card');
    expect(out.data.error).toMatch(/no courses available/i);
    expect(out.data.error).toContain('zion');
    expect(bridges.enrollIn).not.toHaveBeenCalled();
    expect(learnBadges.awardEarnedBadges).not.toHaveBeenCalled();
  });
});

describe('recall_learning_context', () => {
  it('returns a map_snippet of the server-bound user’s full learning memory (not a rendered card)', async () => {
    const mem = {
      enrolled: [{ id: 'lp1', title: 'Geology' }],
      completedLessons: [{ id: 'l1', title: 'L1', score: 1 }],
      mastery: [{ topic: 'Geology', score: 0.8 }],
      struggling: [{ topic: 'Volcanoes', confidence: 0.4 }],
      badges: [{ id: 'cadet', label: 'Cadet', tier: 'bronze' }],
      certificates: [{ lessonPlanId: 'lp1', courseTitle: 'Geology', shareSlug: 's', score: 1, issuedAt: '2026-01-01' }],
    };
    vi.mocked(lq.getLearningMemory).mockResolvedValue(mem as never);
    const out = await exec(recallLearningContext, {});
    expect(out.kind).toBe('map_snippet');
    expect(lq.getLearningMemory).toHaveBeenCalledWith('u1'); // identity from callerId, never the model
    expect(out.data.enrolled).toEqual(mem.enrolled);
    expect(out.data.mastery).toEqual(mem.mastery);
    expect(out.data.badges).toEqual(mem.badges);
    expect(out.data.certificates).toEqual(mem.certificates);
  });
});

describe('tutor_step', () => {
  const content = {
    lesson: { id: 'l1', ordinal: 1, title: 'The Yellowstone Hotspot', durationMin: 15 },
    module: { id: 'm1', ordinal: 1, title: 'Hotspot & Caldera', summary: null },
    lessonPlanId: 'lp1',
    context: {
      lessonPlan: { objective: 'Explain the hotspot.' },
      park: { parkCode: 'yell', fullName: 'Yellowstone National Park' },
      media: { audio: [{ id: 'a1', title: 'Old Faithful', url: 'u', hasTranscript: true }], galleries: [], videos: [] },
      openWindow: null,
    },
  };

  it('teaches a lesson: returns an explanation_card grounded in the graph (with citationLessonId)', async () => {
    vi.mocked(lq.lessonContent).mockResolvedValue(content as never);
    vi.mocked(narrative.getOrGenerateNarrative).mockResolvedValue(null as never);
    const out = await exec(tutorStep, { lessonId: 'l1' });
    expect(out.kind).toBe('explanation_card');
    expect(out.data.citationLessonId).toBe('l1'); // R6: every fact graph-cited
    expect(out.data.title).toBe('The Yellowstone Hotspot');
    expect(out.data.objective).toBe('Explain the hotspot.');
    expect(out.data.media.audio).toHaveLength(1);
    expect(out.data.narrative).toBeNull(); // no cached narrative + generation off
  });

  it('passes the field-trip window through to lessonContent (F1 openness check)', async () => {
    vi.mocked(lq.lessonContent).mockResolvedValue(content as never);
    vi.mocked(narrative.getOrGenerateNarrative).mockResolvedValue(null as never);
    await exec(tutorStep, { lessonId: 'l1', fieldTripStart: '2026-09-21', fieldTripEnd: '2026-09-25' });
    expect(lq.lessonContent).toHaveBeenCalledWith('l1', { start: '2026-09-21', end: '2026-09-25' });
  });

  it('surfaces a cached narrative when one exists', async () => {
    vi.mocked(lq.lessonContent).mockResolvedValue(content as never);
    vi.mocked(narrative.getOrGenerateNarrative).mockResolvedValue({ body: 'A volcanic plume…' } as never);
    const out = await exec(tutorStep, { lessonId: 'l1' });
    expect(out.data.narrative).toBe('A volcanic plume…');
  });

  it('degrades gracefully when narrative generation throws (still teaches from the graph)', async () => {
    vi.mocked(lq.lessonContent).mockResolvedValue(content as never);
    vi.mocked(narrative.getOrGenerateNarrative).mockRejectedValue(new Error('gateway down'));
    const out = await exec(tutorStep, { lessonId: 'l1' });
    expect(out.kind).toBe('explanation_card');
    expect(out.data.narrative).toBeNull();
    expect(out.data.title).toBe('The Yellowstone Hotspot');
  });

  it('returns an error card when the lesson is missing', async () => {
    vi.mocked(lq.lessonContent).mockResolvedValue(null);
    const out = await exec(tutorStep, { lessonId: 'nope' });
    expect(out.kind).toBe('explanation_card');
    expect(out.data.error).toMatch(/not found/i);
  });
});
