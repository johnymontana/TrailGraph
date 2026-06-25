import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub I/O so importing the module is side-effect-free (qualifyingBadgeIds is pure).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./learning-bridges', () => ({ earnBadge: vi.fn() }));
vi.mock('./learn-queries', () => ({ getLearningMemory: vi.fn() }));

import { qualifyingBadgeIds, awardEarnedBadges } from './learn-badges';
import { earnBadge } from './learning-bridges';
import { getLearningMemory } from './learn-queries';

const earnBadgeMock = vi.mocked(earnBadge);
const getLearningMemoryMock = vi.mocked(getLearningMemory);

const base = { enrolled: 0, completedLessons: 0, certificates: 0, mastery: [] as { topic: string; score: number }[] };

// Shape a LearningMemory from terse fixtures; awardEarnedBadges only reads the array lengths + mastery + badges.
function memory(parts: {
  enrolled?: number;
  completedLessons?: number;
  certificates?: number;
  mastery?: { topic: string; score: number }[];
  badges?: { id: string }[];
}) {
  return {
    enrolled: Array.from({ length: parts.enrolled ?? 0 }, (_, i) => ({ id: `c${i}`, title: `Course ${i}` })),
    completedLessons: Array.from({ length: parts.completedLessons ?? 0 }, (_, i) => ({ id: `l${i}`, title: `Lesson ${i}`, score: null })),
    struggling: [],
    mastery: parts.mastery ?? [],
    badges: (parts.badges ?? []).map((b) => ({ id: b.id, label: b.id, tier: 'bronze' })),
    certificates: Array.from({ length: parts.certificates ?? 0 }, (_, i) => ({
      lessonPlanId: `lp${i}`,
      courseTitle: `Course ${i}`,
      shareSlug: `slug${i}`,
      score: null,
      issuedAt: null,
    })),
  };
}

describe('qualifyingBadgeIds (badge milestones)', () => {
  it('explorer on a first enrollment', () => {
    expect(qualifyingBadgeIds({ ...base, enrolled: 1 })).toContain('explorer');
    expect(qualifyingBadgeIds(base)).not.toContain('explorer');
  });
  it('cadet at two completed lessons, not one (no longer fires on a single answer)', () => {
    expect(qualifyingBadgeIds({ ...base, completedLessons: 1 })).not.toContain('cadet');
    expect(qualifyingBadgeIds({ ...base, completedLessons: 2 })).toContain('cadet');
  });
  it('ranger at 1 certificate, senior-ranger only at 3', () => {
    expect(qualifyingBadgeIds({ ...base, certificates: 1 })).toContain('ranger');
    expect(qualifyingBadgeIds({ ...base, certificates: 1 })).not.toContain('senior-ranger');
    expect(qualifyingBadgeIds({ ...base, certificates: 3 })).toEqual(expect.arrayContaining(['ranger', 'senior-ranger']));
  });
  it('geologist on Geology/Volcanoes mastery >= 0.8', () => {
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Geology', score: 0.85 }] })).toContain('geologist');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Volcanoes', score: 0.9 }] })).toContain('geologist');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Geology', score: 0.7 }] })).not.toContain('geologist');
  });
  it('historian on a History-topic mastery >= 0.8', () => {
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Civil War History', score: 0.9 }] })).toContain('historian');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Geology', score: 0.9 }] })).not.toContain('historian');
  });
  it('is empty for a fresh learner', () => {
    expect(qualifyingBadgeIds(base)).toEqual([]);
  });
  it('treats mastery score 0.8 as the inclusive threshold (boundary)', () => {
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Geology', score: 0.8 }] })).toContain('geologist');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Geology', score: 0.7999 }] })).not.toContain('geologist');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Civil War History', score: 0.8 }] })).toContain('historian');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Civil War History', score: 0.79 }] })).not.toContain('historian');
  });
  it('geologist matches Geology/Volcanoes case-sensitively (lowercase "geology" does NOT qualify)', () => {
    // geologist uses exact `t === 'Geology'`, unlike historian's toLowerCase().includes('history').
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'geology', score: 0.9 }] })).not.toContain('geologist');
    expect(qualifyingBadgeIds({ ...base, mastery: [{ topic: 'Volcanoes', score: 0.9 }] })).toContain('geologist');
  });
  it('emits each badge id at most once even with multiple qualifying mastery rows', () => {
    const ids = qualifyingBadgeIds({
      ...base,
      mastery: [
        { topic: 'Geology', score: 0.9 },
        { topic: 'Volcanoes', score: 0.95 },
        { topic: 'Civil War History', score: 0.85 },
        { topic: 'Ancient History', score: 0.88 },
      ],
    });
    expect(ids.filter((id) => id === 'geologist')).toHaveLength(1);
    expect(ids.filter((id) => id === 'historian')).toHaveLength(1);
  });
});

describe('awardEarnedBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awards only not-yet-earned qualifying ids and returns the ones earnBadge confirms newly earned', async () => {
    getLearningMemoryMock.mockResolvedValue(
      memory({
        enrolled: 1,
        completedLessons: 2, // ≥2 now qualifies for 'cadet'
        certificates: 3,
        mastery: [{ topic: 'Geology', score: 0.9 }],
        badges: [{ id: 'explorer' }], // already earned → must be skipped
      }) as never,
    );
    earnBadgeMock.mockResolvedValue(true as never);

    const newly = await awardEarnedBadges('u1');

    // 'explorer' is already earned → earnBadge never called for it.
    const earnedIds = earnBadgeMock.mock.calls.map((c) => c[1]);
    expect(earnedIds).not.toContain('explorer');
    expect(earnedIds).toEqual(['cadet', 'ranger', 'senior-ranger', 'geologist']);
    // earnBadge always passes the resolved caller id.
    for (const call of earnBadgeMock.mock.calls) expect(call[0]).toBe('u1');
    // newly-earned preserves qualifyingBadgeIds order, minus the already-earned 'explorer'.
    expect(newly).toEqual(['cadet', 'ranger', 'senior-ranger', 'geologist']);
  });

  it('excludes ids where earnBadge reports already-present (race) from the newly-earned result', async () => {
    getLearningMemoryMock.mockResolvedValue(
      memory({ enrolled: 1, certificates: 1, badges: [] }) as never,
    );
    // Qualifying = ['explorer','ranger']. earnBadge wins the race for explorer, loses it for ranger.
    earnBadgeMock.mockImplementation((async (_userId: string, id: string) => id === 'explorer') as never);

    const newly = await awardEarnedBadges('u1');

    // Both passed the !earned.has(id) filter, so both are attempted...
    expect(earnBadgeMock.mock.calls.map((c) => c[1])).toEqual(['explorer', 'ranger']);
    // ...but only the one earnBadge confirmed (returned true) is reported newly-earned.
    expect(newly).toEqual(['explorer']);
  });

  it('returns [] when no badges qualify (fresh learner)', async () => {
    getLearningMemoryMock.mockResolvedValue(memory({}) as never);
    earnBadgeMock.mockResolvedValue(true as never);

    const newly = await awardEarnedBadges('u1');

    expect(newly).toEqual([]);
    expect(earnBadgeMock).not.toHaveBeenCalled();
  });
});
