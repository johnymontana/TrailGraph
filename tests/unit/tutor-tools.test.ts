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

import * as ctx from '../../lib/agent-ctx';
import * as bridges from '../../lib/learning-bridges';
import * as lq from '../../lib/learn-queries';
import * as queries from '../../lib/queries';
import * as learnBadges from '../../lib/learn-badges';
import gradeAnswer from '../../agent/tools/grade_answer';
import recommendNext from '../../agent/tools/recommend_next';
import generateQuiz from '../../agent/tools/generate_quiz';
import startLesson from '../../agent/tools/start_lesson';

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
});
