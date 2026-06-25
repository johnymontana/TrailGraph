import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub I/O so importing the module never touches a driver or the queries layer.
vi.mock('./neo4j', () => ({ readGraph: vi.fn() }));
vi.mock('./queries', () => ({ lessonPlanContext: vi.fn() }));

import { quizDifficultyForMastery } from './learn-queries';

describe('quizDifficultyForMastery (adaptive difficulty)', () => {
  it('starts gentle for an unseen topic', () => {
    expect(quizDifficultyForMastery(null)).toBe('easy');
    expect(quizDifficultyForMastery(undefined)).toBe('easy');
  });
  it('low mastery → easy, mid → medium, high → hard', () => {
    expect(quizDifficultyForMastery(0)).toBe('easy');
    expect(quizDifficultyForMastery(0.59)).toBe('easy');
    expect(quizDifficultyForMastery(0.6)).toBe('medium');
    expect(quizDifficultyForMastery(0.8)).toBe('medium');
    expect(quizDifficultyForMastery(0.81)).toBe('hard');
    expect(quizDifficultyForMastery(1)).toBe('hard');
  });
});
