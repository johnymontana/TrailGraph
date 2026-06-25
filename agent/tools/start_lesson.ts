import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { enrollIn } from '../../lib/learning-bridges';
import { lessonPlanProgress } from '../../lib/learn-queries';
import { awardEarnedBadges } from '../../lib/learn-badges';
import { lessonPlansForPark } from '../../lib/queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Start (enroll in) a Ranger School course and return its module/lesson spine with per-lesson completion.
 * With only a parkCode, lists that park's real courses to choose from (graph-grounded — never invents a
 * course). Enrollment is the user's explicit "start" act, so it persists immediately (like save_preference).
 */
export default defineTool({
  description:
    "Start a Ranger School course and show its modules/lessons. Pass lessonPlanId to enroll in + open a specific course; pass parkCode to list that park's available courses first.",
  inputSchema: z.object({
    lessonPlanId: z.string().optional().describe('The lesson-plan (course) id to start.'),
    parkCode: z.string().optional().describe("A park code (e.g. 'yell') to list its courses when no lessonPlanId is given."),
  }),
  async execute({ lessonPlanId, parkCode }, ctx) {
    const userId = callerId(ctx);
    if (!lessonPlanId) {
      if (!parkCode) {
        return { kind: 'lesson_card', data: { error: 'Tell me which course (lessonPlanId) or which park (parkCode) you want to learn about.' } };
      }
      const courses = await lessonPlansForPark(parkCode, 8);
      if (!courses.length) return { kind: 'lesson_card', data: { error: `No courses available for ${parkCode} yet.` } };
      return {
        kind: 'lesson_card',
        data: { parkCode, courses: courses.map((c) => ({ id: c.id, title: c.title, subject: c.subject, gradeLevel: c.gradeLevel })) },
      };
    }
    await enrollIn(userId, lessonPlanId);
    const progress = await lessonPlanProgress(userId, lessonPlanId);
    if (!progress) return { kind: 'lesson_card', data: { error: `Course ${lessonPlanId} not found.` } };
    const earnedBadges = await awardEarnedBadges(userId); // e.g. "explorer" on a first enrollment
    return {
      kind: 'lesson_card',
      data: { lessonPlanId, title: progress.title, enrolled: true, done: progress.done, total: progress.total, modules: progress.modules, earnedBadges },
    };
  },
});
