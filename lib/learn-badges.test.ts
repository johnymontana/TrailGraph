import { describe, it, expect, vi } from 'vitest';

// Stub I/O so importing the module is side-effect-free (qualifyingBadgeIds is pure).
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./learning-bridges', () => ({ earnBadge: vi.fn() }));
vi.mock('./learn-queries', () => ({ getLearningMemory: vi.fn() }));

import { qualifyingBadgeIds } from './learn-badges';

const base = { enrolled: 0, completedLessons: 0, certificates: 0, mastery: [] as { topic: string; score: number }[] };

describe('qualifyingBadgeIds (badge milestones)', () => {
  it('explorer on a first enrollment', () => {
    expect(qualifyingBadgeIds({ ...base, enrolled: 1 })).toContain('explorer');
    expect(qualifyingBadgeIds(base)).not.toContain('explorer');
  });
  it('cadet on a first completed lesson', () => {
    expect(qualifyingBadgeIds({ ...base, completedLessons: 1 })).toContain('cadet');
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
});
