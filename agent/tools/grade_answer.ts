import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { quizGradeData } from '../../lib/learn-queries';
import { recordQuizAttempt, recordMastery, recordStruggle, completeLesson } from '../../lib/learning-bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Grade a quiz answer DETERMINISTICALLY against the cached `QuizQuestion.correctId` — server-side, no model
 * math, zero model tokens. Writes the ANSWERED edge; updates per-topic mastery (when the quiz has a TESTS
 * topic); a wrong answer records a struggle, a correct one completes the lesson. The feedback card reveals
 * the correct answer + the lesson's stored rationale (cited), which is fine post-answer.
 */
export default defineTool({
  description:
    "Grade the learner's quiz answer. Call after a quiz when their reply arrives as 'quizId:choiceId' — pass the quizId and the chosen choiceId.",
  inputSchema: z.object({
    quizId: z.string().describe('The quiz question id that was answered.'),
    choiceId: z.string().describe("The learner's chosen option id."),
  }),
  async execute({ quizId, choiceId }, ctx) {
    const userId = callerId(ctx);
    const truth = await quizGradeData(quizId);
    if (!truth) return { kind: 'quiz_feedback_card', data: { error: `Quiz ${quizId} not found.` } };

    const correct = choiceId === truth.correctId;
    await recordQuizAttempt(userId, quizId, correct, choiceId);

    let mastery: number | null = null;
    if (truth.topic) {
      // Live NPS lessonplans carry no topics, so many decomposed quizzes have no TESTS topic — skip gracefully.
      const m = await recordMastery(userId, truth.topic, correct ? 1 : 0);
      mastery = m?.score ?? null;
      if (!correct) await recordStruggle(userId, truth.topic, 0.7);
    }
    if (correct) await completeLesson(userId, truth.lessonId, 1);

    return {
      kind: 'quiz_feedback_card',
      data: {
        correct,
        correctId: truth.correctId,
        rationale: truth.rationale,
        citationLessonId: truth.lessonId,
        topic: truth.topic,
        mastery,
      },
    };
  },
});
