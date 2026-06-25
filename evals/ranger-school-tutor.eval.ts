import { defineEval } from 'eve/evals';

/**
 * Ranger School tutor loop: the lesson player sends the active ids as Eve `clientContext` (NOT in the
 * message text), so the tutor must read them from there. This proves the no-UUID-in-the-UI fix: the visible
 * message says only "Quiz me on this lesson" / the chosen answer label, yet the agent still grounds
 * `generate_quiz`/`grade_answer` to the right lesson + quiz. Requires the seeded course
 * (`pnpm seed:test` → `lesson-yell-geology:m1:l1`) + AI Gateway → run with `pnpm agent:eval`, not CI.
 */
const LESSON_ID = 'lesson-yell-geology:m1:l1';

export default defineEval({
  async test(t) {
    // 1) "Quiz me" with the lessonId ONLY in clientContext — the message text carries no id.
    const quizTurn = await t.send({ message: 'Quiz me on this lesson', clientContext: { lessonId: LESSON_ID } });
    // Grounded to the lesson from clientContext (not parsed from the message, which has no id).
    t.calledTool('generate_quiz', { input: { lessonId: LESSON_ID } });

    // 2) Answer with the human label as the message and the ids in clientContext (mirrors a QuizCard tap).
    const quizOut = quizTurn.toolCalls.find((c) => c.name === 'generate_quiz')?.output as
      | { data?: { quizId?: string; choices?: { id: string; label: string }[] } }
      | undefined;
    const quizId = quizOut?.data?.quizId;
    const choice = quizOut?.data?.choices?.[0];
    if (quizId && choice) {
      await t.send({ message: choice.label, clientContext: { quizId, choiceId: choice.id } });
      // grade_answer is grounded to the quiz + choice from clientContext, never from the message text.
      t.calledTool('grade_answer', { input: { quizId, choiceId: choice.id } });
    }

    await t.completed();
  },
});
