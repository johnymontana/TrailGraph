import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { pickQuizForLesson, masteryByTopic, quizDifficultyForMastery } from '../../lib/learn-queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Emit a quiz question for a lesson, at a difficulty adapted to the learner's mastery. Reads a PRE-CACHED
 * `:QuizQuestion` — NO model call, and it NEVER ships the correct answer (anti-cheat; grading is server-side
 * in grade_answer). After calling this the turn STOPS: the quiz_card sends 'quizId:choiceId' as the next
 * message, which grade_answer then scores.
 */
export default defineTool({
  description:
    "Give the learner a quiz question for a lesson, adapted to their mastery. Renders as tappable choices. After calling this, STOP — do NOT call another tool or reveal the answer; wait for the learner's reply (it arrives as 'quizId:choiceId').",
  inputSchema: z.object({
    lessonId: z.string().describe('The lesson to quiz on.'),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional().describe('Override the adaptive difficulty.'),
  }),
  async execute({ lessonId, difficulty }, ctx) {
    let chosen = difficulty as string | undefined;
    if (!chosen) {
      try {
        const userId = callerId(ctx);
        const mastery = await masteryByTopic(userId);
        const weakest = mastery.length ? Math.min(...mastery.map((m) => m.mastery)) : null;
        chosen = quizDifficultyForMastery(weakest);
      } catch {
        chosen = 'easy'; // anonymous / cold-start → start gentle
      }
    }
    const quiz = await pickQuizForLesson(lessonId, chosen);
    if (!quiz) return { kind: 'quiz_card', data: { error: `No quiz available for lesson ${lessonId} yet.` } };
    return { kind: 'quiz_card', data: { quizId: quiz.id, stem: quiz.stem, choices: quiz.choices, difficulty: quiz.difficulty, lessonId } };
  },
});
