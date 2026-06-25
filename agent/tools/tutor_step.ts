import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { lessonContent } from '../../lib/learn-queries';
import { getOrGenerateNarrative } from '../../lib/lesson-narrative';

/**
 * Teach one lesson, grounded in the graph: its title/module/objective + the park's real NPS audio tours,
 * videos, and open-window feasibility (F6/F1), reusing `lessonContent`. Zero model tokens by default; when
 * `GENERATE_NARRATIVES=1` it enriches with a cached `:LessonContent` narrative (generated once per lesson).
 * Read-only. Every fact is graph-sourced (R6) — the card carries `citationLessonId`.
 */
export default defineTool({
  description:
    "Teach a specific Ranger School lesson: returns its objective, the park's audio tours / videos, and field-trip feasibility, grounded entirely in the graph. Call after start_lesson, for one lesson at a time.",
  inputSchema: z.object({
    lessonId: z.string().describe('The lesson id to teach, e.g. "lesson-yell-geology:m1:l1".'),
    fieldTripStart: z.string().optional().describe('Optional ISO date (YYYY-MM-DD) to check park openness for a field trip.'),
    fieldTripEnd: z.string().optional().describe('Optional ISO end date for the field-trip window.'),
  }),
  async execute({ lessonId, fieldTripStart, fieldTripEnd }) {
    const ctx = await lessonContent(lessonId, { start: fieldTripStart ?? null, end: fieldTripEnd ?? null });
    if (!ctx) return { kind: 'explanation_card', data: { error: `Lesson ${lessonId} not found.` } };
    // Optional richer prose — only if a cached narrative exists or generation is enabled (cost control).
    const narrative = (await getOrGenerateNarrative(lessonId).catch(() => null))?.body ?? null;
    return {
      kind: 'explanation_card',
      data: {
        lessonId,
        citationLessonId: lessonId,
        title: ctx.lesson.title,
        moduleTitle: ctx.module.title,
        objective: ctx.context?.lessonPlan.objective ?? null,
        narrative,
        park: ctx.context?.park ?? null,
        media: ctx.context?.media ?? { audio: [], galleries: [], videos: [] },
        openWindow: ctx.context?.openWindow ?? null,
      },
    };
  },
});
