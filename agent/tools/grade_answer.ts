import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { quizGradeData } from '../../lib/learn-queries';
import { recordQuizAttempt, recordMastery, recordStruggle, completeLesson } from '../../lib/learning-bridges';
import { awardEarnedBadges } from '../../lib/learn-badges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Grade a quiz answer DETERMINISTICALLY against the cached `QuizQuestion.correctId` — server-side, no model
 * math, zero model tokens. Writes the ANSWERED edge; updates per-topic mastery (when the quiz has a TESTS
 * topic); a wrong answer records a struggle, a correct one completes the lesson. The feedback card reveals
 * the correct answer + the lesson's stored rationale (cited), which is fine post-answer.
 */
export default defineTool({
  description:
    "Grade the learner's quiz answer. Call after a quiz when the learner taps a choice — pass the quizId and the chosen choiceId (both provided as client context alongside their reply).",
  inputSchema: z.object({
    quizId: z.string().describe('The quiz question id that was answered.'),
    choiceId: z.string().describe("The learner's chosen option id."),
  }),
  async execute({ quizId, choiceId }, ctx) {
    const userId = callerId(ctx);
    const truth = await quizGradeData(quizId);
    if (!truth) return { kind: 'quiz_feedback_card', data: { error: `Quiz ${quizId} not found.` } };

    const correct = choiceId === truth.correctId;
    const labelFor = (id: string) => truth.choices.find((c) => c.id === id)?.label ?? null;
    await recordQuizAttempt(userId, quizId, correct, choiceId);

    // Record mastery (+ struggle on a miss) for EVERY topic the quiz tests. May be empty until
    // deriveLessonTopics grounds the course in its park's topics — then it's skipped gracefully.
    let mastery: number | null = null;
    for (const topic of truth.topics) {
      const m = await recordMastery(userId, topic, correct ? 1 : 0);
      if (mastery === null) mastery = m?.score ?? null; // surface the first topic's mastery on the card
      if (!correct) await recordStruggle(userId, topic, 0.7);
    }
    if (correct) await completeLesson(userId, truth.lessonId, 1);
    const earnedBadges = await awardEarnedBadges(userId); // e.g. "cadet" on a first completed lesson, topic badges on mastery

    return {
      kind: 'quiz_feedback_card',
      data: {
        quizId,
        correct,
        correctId: truth.correctId,
        correctLabel: labelFor(truth.correctId),
        chosenLabel: labelFor(choiceId),
        rationale: truth.rationale,
        citationLessonId: truth.lessonId,
        topics: truth.topics,
        mastery,
        earnedBadges,
      },
    };
  },
});
