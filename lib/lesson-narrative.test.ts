import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// Pure-logic test: stub all I/O so importing the module never touches a driver or the AI gateway.
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('./generate', () => ({ generateText: vi.fn() }));

import { getOrGenerateNarrative } from './lesson-narrative';
import { readGraph, writeGraph } from './neo4j';
import { generateText } from './generate';

const readGraphMock = vi.mocked(readGraph);
const writeGraphMock = vi.mocked(writeGraph);
const generateTextMock = vi.mocked(generateText);

// Mirror the source's hash formula (`${lessonId}|title|module|objective` + version). NARRATIVE_VERSION
// is read at module load, so 'v1' is the default in test (env not set before import).
function expectedHash(
  lessonId: string,
  lessonTitle: string,
  moduleTitle: string | null,
  objective: string | null,
): string {
  const sourceText = `${lessonId}|${lessonTitle}|${moduleTitle ?? ''}|${objective ?? ''}`;
  return createHash('sha256').update(`${sourceText}|v1`).digest('hex');
}

const LESSON = { lessonTitle: 'Tides & Pools', moduleTitle: 'Coastal Ecology', objective: 'Explain intertidal zonation' };

describe('getOrGenerateNarrative', () => {
  const prevFlag = process.env.GENERATE_NARRATIVES;

  beforeEach(() => {
    readGraphMock.mockReset();
    writeGraphMock.mockReset();
    generateTextMock.mockReset();
    delete process.env.GENERATE_NARRATIVES; // default-off cost gate
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.GENERATE_NARRATIVES;
    else process.env.GENERATE_NARRATIVES = prevFlag;
  });

  it('returns null for a nonexistent lesson and never calls the model', async () => {
    readGraphMock.mockResolvedValueOnce([]); // source lookup → empty

    const result = await getOrGenerateNarrative('lesson:missing');

    expect(result).toBeNull();
    // Short-circuited at `if (!src.length) return null` — no cache read, no model, no write.
    expect(readGraphMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(writeGraphMock).not.toHaveBeenCalled();
  });

  it('returns the cached narrative when contentHash matches (no model call)', async () => {
    const lessonId = 'lesson:tides';
    const hash = expectedHash(lessonId, LESSON.lessonTitle, LESSON.moduleTitle, LESSON.objective);

    readGraphMock
      .mockResolvedValueOnce([LESSON]) // source
      .mockResolvedValueOnce([{ body: 'cached prose', contentHash: hash }]); // cache hit, same hash

    const result = await getOrGenerateNarrative(lessonId);

    expect(result).toEqual({
      id: `${lessonId}:content:narrative`,
      body: 'cached prose',
      contentHash: hash,
      cached: true,
    });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(writeGraphMock).not.toHaveBeenCalled();
    expect(readGraphMock).toHaveBeenCalledTimes(2);
  });

  it('returns null on a cache miss when GENERATE_NARRATIVES is unset (cost gate)', async () => {
    const lessonId = 'lesson:tides';
    readGraphMock
      .mockResolvedValueOnce([LESSON]) // source
      .mockResolvedValueOnce([]); // empty cache → miss

    const result = await getOrGenerateNarrative(lessonId);

    expect(result).toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(writeGraphMock).not.toHaveBeenCalled();
  });

  it('returns null on a STALE cache (hash mismatch) when GENERATE_NARRATIVES is unset', async () => {
    const lessonId = 'lesson:tides';
    readGraphMock
      .mockResolvedValueOnce([LESSON]) // source
      .mockResolvedValueOnce([{ body: 'old prose', contentHash: 'deadbeef-stale' }]); // wrong hash

    const result = await getOrGenerateNarrative(lessonId);

    // Stale hash is NOT a hit, and with the flag off it does not regenerate.
    expect(result).toBeNull();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(writeGraphMock).not.toHaveBeenCalled();
  });

  it('generates, caches, and returns cached:false on a miss when GENERATE_NARRATIVES=1', async () => {
    process.env.GENERATE_NARRATIVES = '1';
    const lessonId = 'lesson:tides';
    const hash = expectedHash(lessonId, LESSON.lessonTitle, LESSON.moduleTitle, LESSON.objective);

    readGraphMock
      .mockResolvedValueOnce([LESSON]) // source
      .mockResolvedValueOnce([]); // miss
    generateTextMock.mockResolvedValueOnce('  body text  '); // trimmed by source
    writeGraphMock.mockResolvedValueOnce([] as never);

    const result = await getOrGenerateNarrative(lessonId);

    expect(result).toEqual({
      id: `${lessonId}:content:narrative`,
      body: 'body text',
      contentHash: hash,
      cached: false,
    });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    // Model arg defaults to the agent model (NARRATIVE_MODEL unset → undefined passed to generateText).
    expect(generateTextMock.mock.calls[0][0]).toMatchObject({ model: undefined, maxTokens: 600, temperature: 0.4 });
    // The cache write persists trimmed body + hash; model param defaults to 'default'.
    expect(writeGraphMock).toHaveBeenCalledTimes(1);
    expect(writeGraphMock.mock.calls[0][1]).toEqual({
      lessonId,
      contentId: `${lessonId}:content:narrative`,
      body: 'body text',
      hash,
      model: 'default',
    });
  });

  it('returns null and does NOT write when the model yields empty/whitespace output (flag on)', async () => {
    process.env.GENERATE_NARRATIVES = '1';
    const lessonId = 'lesson:tides';
    readGraphMock
      .mockResolvedValueOnce([LESSON]) // source
      .mockResolvedValueOnce([]); // miss
    generateTextMock.mockResolvedValueOnce('   \n  '); // trims to empty

    const result = await getOrGenerateNarrative(lessonId);

    expect(result).toBeNull();
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(writeGraphMock).not.toHaveBeenCalled();
  });

  it('builds the model prompt from only stored fields and omits null module/objective (anti-hallucination)', async () => {
    process.env.GENERATE_NARRATIVES = '1';
    const lessonId = 'lesson:bare';
    readGraphMock
      .mockResolvedValueOnce([{ lessonTitle: 'Lone Lesson', moduleTitle: null, objective: null }])
      .mockResolvedValueOnce([]); // miss
    generateTextMock.mockResolvedValueOnce('derived prose');
    writeGraphMock.mockResolvedValueOnce([] as never);

    await getOrGenerateNarrative(lessonId);

    const opts = generateTextMock.mock.calls[0][0];
    expect(opts.prompt).toBe('Lesson: Lone Lesson'); // no Module:/Objective: lines for null fields
    // hash for the null-fields case still keys on the stored source text only.
    const hash = expectedHash(lessonId, 'Lone Lesson', null, null);
    expect(writeGraphMock.mock.calls[0][1]).toMatchObject({ hash });
  });
});
