import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { pickQuizForLesson, masteryByTopic, quizDifficultyForMastery, recentQuizIdsForLesson } from '../../lib/learn-queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Emit a quiz question for a lesson, at a difficulty adapted to the learner's mastery. Reads a PRE-CACHED
 * `:QuizQuestion` — NO model call, and it NEVER ships the correct answer (anti-cheat; grading is server-side
 * in grade_answer). After calling this the turn STOPS: the quiz_card sends the chosen answer's label as the
 * next message, with quizId/choiceId in client context, which grade_answer then scores.
 */
export default defineTool({
  description:
    "Give the learner a quiz question for a lesson, adapted to their mastery. Renders as tappable choices. After calling this, STOP — do NOT call another tool or reveal the answer; wait for the learner's reply (their chosen answer text arrives as the next message, with the quizId and choiceId in client context).",
  inputSchema: z.object({
    lessonId: z.string().describe('The lesson to quiz on.'),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional().describe('Override the adaptive difficulty.'),
  }),
  async execute({ lessonId, difficulty }, ctx) {
    let userId: string | null = null;
    try {
      userId = callerId(ctx);
    } catch {
      userId = null; // anonymous / cold-start
    }

    let chosen = difficulty as string | undefined;
    if (!chosen) {
      if (userId) {
        try {
          const mastery = await masteryByTopic(userId);
          const weakest = mastery.length ? Math.min(...mastery.map((m) => m.mastery)) : null;
          chosen = quizDifficultyForMastery(weakest);
        } catch {
          chosen = 'easy';
        }
      } else {
        chosen = 'easy'; // start gentle when we can't read mastery
      }
    }

    // Skip questions the learner just answered for this lesson so a re-quiz serves a fresh item (and, since
    // the bank is one-per-difficulty, naturally climbs to a harder question). Anonymous → no exclusions.
    let excludeIds: string[] = [];
    if (userId) {
      try {
        excludeIds = await recentQuizIdsForLesson(userId, lessonId, 5);
      } catch {
        excludeIds = [];
      }
    }

    // Fall back to a repeat only if every question has been served recently — never leave the learner stuck.
    const quiz = (await pickQuizForLesson(lessonId, chosen, excludeIds)) ?? (await pickQuizForLesson(lessonId, chosen));
    if (!quiz) return { kind: 'quiz_card', data: { error: `No quiz available for lesson ${lessonId} yet.` } };
    return { kind: 'quiz_card', data: { quizId: quiz.id, stem: quiz.stem, choices: quiz.choices, difficulty: quiz.difficulty, lessonId } };
  },
});
