import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-logic test: stub I/O so importing the module never touches a driver.
vi.mock('../neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { matchParkTopics, deriveLessonTopics } from './derive-lesson-topics';
import { readGraph, writeGraph } from '../neo4j';

const mockRead = vi.mocked(readGraph);
const mockWrite = vi.mocked(writeGraph);

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

  it('ignores topics with empty/whitespace-only or pure-punctuation names', () => {
    // A blank name tokenizes to [] → the `toks.length > 0` guard prevents a vacuous every() match.
    expect(matchParkTopics('anything here', [{ id: 'e', name: '   ' }])).toEqual([]);
    expect(matchParkTopics('anything here', [{ id: 'e2', name: '' }])).toEqual([]);
    // Pure punctuation strips to nothing → no match against arbitrary text.
    expect(matchParkTopics('really exciting stuff!!!', [{ id: 'p', name: '!!!' }])).toEqual([]);
  });

  it('is case-insensitive, preserves topic input order, and matches numeric tokens', () => {
    // (1) case-folded match.
    expect(matchParkTopics('GEOLOGY rocks', [{ id: 'g', name: 'geology' }]).map((t) => t.id)).toEqual(['g']);
    // (2) result follows the topics-array order, NOT the order words appear in the text.
    const ordered = [
      { id: 't-geology', name: 'Geology' },
      { id: 't-wildlife', name: 'Wildlife' },
    ];
    expect(matchParkTopics('Wildlife and Geology', ordered).map((t) => t.id)).toEqual(['t-geology', 't-wildlife']);
    // (3) digits survive tokenize so a numeric topic name matches.
    expect(matchParkTopics('Established in 1872', [{ id: 'y', name: '1872' }]).map((t) => t.id)).toEqual(['y']);
  });
});

describe('deriveLessonTopics', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockWrite.mockReset();
  });

  it('short-circuits to zero counts and skips writes when no plan matches any topic', async () => {
    mockRead.mockResolvedValueOnce([
      {
        id: 'lp-none',
        title: 'Algae blooms',
        subject: 'pond ecology',
        topics: [{ id: 't1', name: 'Geology' }],
      },
    ] as never);

    const result = await deriveLessonTopics();

    expect(result).toEqual({ linkedPlans: 0, relatesEdges: 0, testsEdges: 0 });
    // The `if (!links.length) return` guard must avoid issuing an empty UNWIND.
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('keys on topic id and forwards matched topicIds to both write queries', async () => {
    mockRead.mockResolvedValueOnce([
      {
        id: 'lp1',
        title: 'Geology and Wildlife',
        subject: null,
        topics: [
          { id: 't1', name: 'Geology' },
          { id: 't2', name: 'Wildlife' },
          { id: 't3', name: 'Fossils' }, // not present in title → excluded
        ],
      },
    ] as never);
    mockWrite
      .mockResolvedValueOnce([{ relates: 2 }] as never)
      .mockResolvedValueOnce([{ tests: 2 }] as never);

    const result = await deriveLessonTopics();

    expect(mockWrite).toHaveBeenCalledTimes(2);

    // First write: RELATES_TO_TOPIC, keyed on topic id (Fossils 't3' excluded though it is a candidate).
    const [relQuery, relParams] = mockWrite.mock.calls[0] as [string, { links: Array<{ id: string; topicIds: string[] }> }];
    expect(relQuery).toContain('RELATES_TO_TOPIC');
    expect(relParams).toEqual({ links: [{ id: 'lp1', topicIds: ['t1', 't2'] }] });

    // Second write: backfill TESTS, keyed by lesson plan id only.
    const [tstQuery, tstParams] = mockWrite.mock.calls[1] as [string, { ids: string[] }];
    expect(tstQuery).toContain('TESTS');
    expect(tstParams).toEqual({ ids: ['lp1'] });

    expect(result).toEqual({ linkedPlans: 1, relatesEdges: 2, testsEdges: 2 });
  });

  it('tolerates null title/subject and missing write-query result rows', async () => {
    mockRead.mockResolvedValueOnce([
      {
        id: 'lp2',
        title: null, // `${title ?? ''}` coalesce keeps the match working off subject alone.
        subject: 'Geology basics',
        topics: [{ id: 't1', name: 'Geology' }],
      },
    ] as never);
    // Both writes resolve with NO rows → counts must fall back to 0 (not undefined/NaN).
    mockWrite.mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);

    const result = await deriveLessonTopics();

    expect(mockWrite).toHaveBeenCalledTimes(2);
    const [, relParams] = mockWrite.mock.calls[0] as [string, { links: Array<{ id: string; topicIds: string[] }> }];
    expect(relParams).toEqual({ links: [{ id: 'lp2', topicIds: ['t1'] }] });

    expect(result).toEqual({ linkedPlans: 1, relatesEdges: 0, testsEdges: 0 });
    expect(typeof result.relatesEdges).toBe('number');
    expect(typeof result.testsEdges).toBe('number');
  });
});
