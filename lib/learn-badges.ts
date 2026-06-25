import { readGraph } from './neo4j';
import { earnBadge } from './learning-bridges';
import { getLearningMemory } from './learn-queries';

/**
 * Ranger School badge milestones (gamification). The 6 badges are seeded in migration 021 but only `ranger`
 * was ever awarded — this wires the rest. `qualifyingBadgeIds` is pure (unit-tested): given the learner's
 * tallies, return every badge id they now qualify for; `awardEarnedBadges` MERGEs the not-yet-earned ones.
 */
export function qualifyingBadgeIds(state: {
  enrolled: number;
  completedLessons: number;
  certificates: number;
  mastery: { topic: string; score: number }[];
}): string[] {
  const ids: string[] = [];
  if (state.enrolled >= 1) ids.push('explorer'); // enroll in your first course
  if (state.completedLessons >= 1) ids.push('cadet'); // complete your first lesson
  if (state.certificates >= 1) ids.push('ranger'); // complete a course
  if (state.certificates >= 3) ids.push('senior-ranger'); // complete three courses
  const mastered = (match: (t: string) => boolean) => state.mastery.some((m) => m.score >= 0.8 && match(m.topic));
  if (mastered((t) => t === 'Geology' || t === 'Volcanoes')) ids.push('geologist'); // topic specialist
  if (mastered((t) => t.toLowerCase().includes('history'))) ids.push('historian');
  return ids;
}

/** Evaluate the milestones for a user and award any newly-qualified badges. Returns the newly-earned ids. */
export async function awardEarnedBadges(userId: string): Promise<string[]> {
  const mem = await getLearningMemory(userId);
  const earned = new Set(mem.badges.map((b) => b.id));
  const qualifying = qualifyingBadgeIds({
    enrolled: mem.enrolled.length,
    completedLessons: mem.completedLessons.length,
    certificates: mem.certificates.length,
    mastery: mem.mastery,
  });
  const newly: string[] = [];
  for (const id of qualifying) {
    if (!earned.has(id) && (await earnBadge(userId, id))) newly.push(id);
  }
  return newly;
}

export interface BadgeInfo {
  id: string;
  label: string;
  tier: string;
  criteria: string | null;
}

/** The full badge taxonomy (seeded in migration 021), ordered bronze → silver → gold → topic. */
export async function allBadges(): Promise<BadgeInfo[]> {
  return readGraph<BadgeInfo>(
    `MATCH (b:Badge)
     RETURN b.id AS id, b.label AS label, b.tier AS tier, b.criteria AS criteria
     ORDER BY CASE b.tier WHEN 'bronze' THEN 0 WHEN 'silver' THEN 1 WHEN 'gold' THEN 2 ELSE 3 END, b.label ASC`,
  );
}
