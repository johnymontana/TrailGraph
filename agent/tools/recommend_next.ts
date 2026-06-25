import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { lessonContent, lessonPlanProgress, masteryByTopic } from '../../lib/learn-queries';
import { issueCertificate } from '../../lib/learning-bridges';
import { awardEarnedBadges } from '../../lib/learn-badges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Recommend the learner's next step after a lesson — pure graph computation + bridge writes, reason cites
 * real progress (R6): advance to the next uncompleted lesson, remediate the weakest topic, or — when every
 * lesson is done — issue the certificate (score = average topic mastery) + the Junior Ranger badge.
 */
export default defineTool({
  description:
    "After a lesson/quiz, recommend the learner's next step: advance to the next lesson, remediate a weak topic, or finish the course (issuing a certificate + Junior Ranger badge on completion).",
  inputSchema: z.object({
    lessonId: z.string().describe('The lesson the learner just finished.'),
  }),
  async execute({ lessonId }, ctx) {
    const userId = callerId(ctx);
    const lc = await lessonContent(lessonId);
    if (!lc?.lessonPlanId) return { kind: 'next_step_card', data: { error: `Lesson ${lessonId} not found.` } };

    const progress = await lessonPlanProgress(userId, lc.lessonPlanId);
    if (!progress) return { kind: 'next_step_card', data: { error: 'Course not found.' } };

    // Course complete → certificate (score = avg topic mastery) + Junior Ranger badge.
    if (progress.total > 0 && progress.done >= progress.total) {
      const mastery = await masteryByTopic(userId, lc.lessonPlanId);
      const avg = mastery.length ? mastery.reduce((s, m) => s + m.mastery, 0) / mastery.length : 1;
      const certificate = await issueCertificate(userId, lc.lessonPlanId, avg);
      const earnedBadges = await awardEarnedBadges(userId); // ranger now, senior-ranger at the 3rd course
      return {
        kind: 'next_step_card',
        data: {
          recommendation: 'complete',
          lessonPlanId: lc.lessonPlanId,
          courseTitle: progress.title,
          certificate,
          earnedBadges,
          reason: `You completed all ${progress.total} lessons of "${progress.title}".`,
        },
      };
    }

    const flat = progress.modules.flatMap((m) => m.lessons);

    // The just-finished lesson is still incomplete → the learner missed its quiz (a correct answer is the
    // only thing that writes COMPLETED). Recommend REVIEW of THIS lesson, never a contradictory "advance".
    const justFinished = flat.find((l) => l.id === lessonId);
    if (justFinished && !justFinished.completed) {
      return {
        kind: 'next_step_card',
        data: {
          recommendation: 'retry',
          lessonId: justFinished.id,
          lessonTitle: justFinished.title,
          courseTitle: progress.title,
          reason: `Let's review "${justFinished.title}" and try again before moving on.`,
        },
      };
    }

    // Next uncompleted lesson in the spine.
    const next = flat.find((l) => !l.completed);
    if (next) {
      return {
        kind: 'next_step_card',
        data: {
          recommendation: 'advance',
          lessonId: next.id,
          lessonTitle: next.title,
          courseTitle: progress.title,
          reason: `${progress.done} of ${progress.total} lessons done — up next: "${next.title}".`,
        },
      };
    }

    // No uncompleted lesson but not flagged complete (e.g. empty modules) → remediate the weakest topic.
    const mastery = await masteryByTopic(userId, lc.lessonPlanId);
    const weakest = mastery.filter((m) => m.mastery < 0.6).sort((a, b) => a.mastery - b.mastery)[0];
    return {
      kind: 'next_step_card',
      data: {
        recommendation: weakest ? 'remediate' : 'advance',
        topic: weakest?.topic ?? null,
        courseTitle: progress.title,
        reason: weakest ? `Let's reinforce "${weakest.topic}" before moving on.` : 'Keep going!',
      },
    };
  },
});
