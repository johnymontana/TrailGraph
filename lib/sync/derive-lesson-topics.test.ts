import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub I/O so importing the module never touches a driver.
vi.mock('../neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { matchParkTopics } from './derive-lesson-topics';

const TOPICS = [
  { id: 't1', name: 'Geology' },
  { id: 't2', name: 'Wildlife' },
  { id: 't3', name: 'Native American Heritage' },
  { id: 't4', name: 'Ice' },
];

describe('matchParkTopics', () => {
  it('matches a whole-word topic in the title', () => {
    expect(matchParkTopics('Geology of Yellowstone', TOPICS).map((t) => t.id)).toEqual(['t1']);
  });

  it('matches a multi-word topic only when EVERY word is present', () => {
    expect(matchParkTopics('A Native American Heritage Day', TOPICS).map((t) => t.id)).toEqual(['t3']);
    expect(matchParkTopics('Native plants of the desert', TOPICS).map((t) => t.id)).toEqual([]); // not all words
  });

  it('is word-boundary + punctuation safe (no substring false positives)', () => {
    expect(matchParkTopics('Life in the Ice Age', TOPICS).map((t) => t.id)).toEqual(['t4']);
    expect(matchParkTopics('customer service desk', TOPICS).map((t) => t.id)).toEqual([]); // "service" must NOT match "Ice"
    expect(matchParkTopics('Wolves: apex predators', [{ id: 'w', name: 'Wolves' }]).map((t) => t.id)).toEqual(['w']);
  });

  it('returns [] for no match or empty text', () => {
    expect(matchParkTopics('Algae blooms', TOPICS)).toEqual([]);
    expect(matchParkTopics('', TOPICS)).toEqual([]);
  });
});
