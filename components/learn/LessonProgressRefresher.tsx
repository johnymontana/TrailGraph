'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps the server-rendered lesson player reactive: when the tutor grades a quiz, `ChatPanel` dispatches
 * `rangerschool:quiz-graded` (mirroring the shipped `trailgraph:trips-changed` announce). This listener
 * calls `router.refresh()` so the left-rail progress counter + lesson checkmarks re-render from a fresh
 * `lessonPlanProgress` read — no manual reload. `grade_answer` writes COMPLETED synchronously before the
 * feedback card streams, so the refresh always reads post-write state.
 *
 * `router.refresh()` re-runs only the Server Components in this route; the sibling `ChatPanel` client island
 * (stable props, no `key` change) is NOT remounted, so the tutor transcript and Eve session are preserved.
 * Renders nothing.
 */
export function LessonProgressRefresher() {
  const router = useRouter();
  useEffect(() => {
    const onGraded = () => router.refresh();
    window.addEventListener('rangerschool:quiz-graded', onGraded);
    return () => window.removeEventListener('rangerschool:quiz-graded', onGraded);
  }, [router]);
  return null;
}
