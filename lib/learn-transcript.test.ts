import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-logic test: stub the driver so importing the module never opens a connection. The factory is hoisted,
// so use inline vi.fn() and grab typed references via vi.mocked() after the import (the repo pattern).
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { readGraph, writeGraph } from './neo4j';
import { getTutorTranscript, saveTutorTranscript } from './learn-transcript';

const readGraphMock = vi.mocked(readGraph);
const writeGraphMock = vi.mocked(writeGraph);

describe('learn-transcript', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getTutorTranscript returns empty + binds the composite { userId, id } when no node exists', async () => {
    readGraphMock.mockResolvedValue([]);
    const t = await getTutorTranscript('u1', 'lesson-x:m1:l1');
    expect(t).toEqual({ events: [], session: null });
    expect(readGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', id: 'u1::lesson-x:m1:l1' });
  });

  it('getTutorTranscript round-trips the stored JSON strings', async () => {
    readGraphMock.mockResolvedValue([{ events: '[{"type":"x"}]', session: '{"sessionId":"s"}' }]);
    const t = await getTutorTranscript('u1', 'l1');
    expect(t.events).toEqual([{ type: 'x' }]);
    expect(t.session).toEqual({ sessionId: 's' });
  });

  it('getTutorTranscript degrades gracefully on malformed stored JSON', async () => {
    readGraphMock.mockResolvedValue([{ events: 'not json', session: null }]);
    const t = await getTutorTranscript('u1', 'l1');
    expect(t).toEqual({ events: [], session: null });
  });

  it('saveTutorTranscript MERGEs with stringified events/session under the composite id', async () => {
    writeGraphMock.mockResolvedValue([]);
    await saveTutorTranscript('u1', 'l1', { events: [{ a: 1 }], session: { s: 2 } });
    const params = writeGraphMock.mock.calls[0][1]!;
    expect(params.id).toBe('u1::l1');
    expect(params.lessonId).toBe('l1');
    expect(JSON.parse(params.events as string)).toEqual([{ a: 1 }]);
    expect(JSON.parse(params.session as string)).toEqual({ s: 2 });
  });
});
