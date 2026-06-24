import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const searchEntities = vi.fn();
const getConversationContext = vi.fn();
const writePreferenceBridge = vi.fn();
const extractCanonicalTerms = vi.fn();
const isParksRelevant = vi.fn();

vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));
vi.mock('./memory', () => ({
  memory: {
    searchEntities: (...a: unknown[]) => searchEntities(...a),
    getConversationContext: (...a: unknown[]) => getConversationContext(...a),
  },
}));
vi.mock('./bridges', () => ({ writePreferenceBridge: (...a: unknown[]) => writePreferenceBridge(...a) }));
vi.mock('./canonicalize', () => ({
  extractCanonicalTerms: (...a: unknown[]) => extractCanonicalTerms(...a),
  isParksRelevant: (...a: unknown[]) => isParksRelevant(...a),
}));

import { reconcileUser, reconcileAll } from './reconcile-memory';

beforeEach(() => {
  readGraph.mockReset();
  searchEntities.mockReset();
  getConversationContext.mockReset();
  writePreferenceBridge.mockReset();
  extractCanonicalTerms.mockReset();
  isParksRelevant.mockReset();
  writePreferenceBridge.mockResolvedValue({ canonicalized: true });
  isParksRelevant.mockResolvedValue(true); // on-topic by default; the off-topic test overrides
});

describe('reconcileUser — two recall paths → PREFERS bridges (R2 §3.2)', () => {
  it('bridges NAMS preference entities AND deterministic message-scan terms', async () => {
    searchEntities.mockResolvedValue([{ name: 'Hiking' }]); // NAMS-extracted preference
    readGraph.mockResolvedValue([{ conversationId: 'c1' }]); // one agent session
    getConversationContext.mockResolvedValue({
      reflections: [],
      observations: [],
      recentMessages: [
        { role: 'user', content: 'I love dark skies and alpine lakes' },
        { role: 'assistant', content: 'noted' },
      ],
    });
    extractCanonicalTerms.mockResolvedValue([
      { target: { kind: 'activity', name: 'Astronomy' } },
      { target: { kind: 'topic', name: 'Lakes' } },
    ]);

    const res = await reconcileUser('u1');

    // NAMS pref + 2 scanned terms = 3 bridges written
    expect(writePreferenceBridge).toHaveBeenCalledWith({ userId: 'u1', category: 'activity', value: 'Hiking' });
    expect(writePreferenceBridge).toHaveBeenCalledWith({ userId: 'u1', category: 'activity', value: 'Astronomy' });
    expect(writePreferenceBridge).toHaveBeenCalledWith({ userId: 'u1', category: 'topic', value: 'Lakes' });
    // the scan only reads the USER's messages, not the assistant's
    expect(extractCanonicalTerms).toHaveBeenCalledWith('I love dark skies and alpine lakes');
    expect(res.written).toBe(3);
  });

  it('skips off-topic user turns so they never reach preference extraction (R5 §2.6)', async () => {
    searchEntities.mockResolvedValue([]); // no NAMS prefs
    readGraph.mockResolvedValue([{ conversationId: 'c1' }]);
    getConversationContext.mockResolvedValue({
      recentMessages: [
        { role: 'user', content: 'write me a carbonara recipe' }, // off-topic
        { role: 'user', content: 'I love dark skies' }, // on-topic
      ],
    });
    isParksRelevant.mockImplementation(async (t: string) => t.includes('dark skies'));
    extractCanonicalTerms.mockResolvedValue([{ target: { kind: 'activity', name: 'Astronomy' } }]);

    const res = await reconcileUser('u1');

    // The recipe turn is never extracted; only the on-topic turn is.
    expect(extractCanonicalTerms).toHaveBeenCalledTimes(1);
    expect(extractCanonicalTerms).toHaveBeenCalledWith('I love dark skies');
    expect(extractCanonicalTerms).not.toHaveBeenCalledWith('write me a carbonara recipe');
    expect(res.written).toBe(1);
  });

  it('counts suppressed/uncanonicalized bridges as skipped, not written', async () => {
    searchEntities.mockResolvedValue([{ name: 'Hiking' }, { name: 'Gibberish' }]);
    readGraph.mockResolvedValue([]); // no sessions
    writePreferenceBridge
      .mockResolvedValueOnce({ canonicalized: true })
      .mockResolvedValueOnce({ canonicalized: false }); // didn't resolve to a domain node
    const res = await reconcileUser('u1');
    expect(res).toEqual({ written: 1, skipped: 1 });
  });

  it('is resilient when NAMS is unavailable (searchEntities throws → no NAMS bridges)', async () => {
    searchEntities.mockRejectedValue(new Error('NAMS down'));
    readGraph.mockResolvedValue([]);
    const res = await reconcileUser('u1');
    expect(res).toEqual({ written: 0, skipped: 0 });
  });
});

describe('reconcileAll', () => {
  it('reconciles each user with an agent session and sums written bridges', async () => {
    // 1st readGraph call: the distinct-users query; subsequent calls: per-user session lookups.
    readGraph
      .mockResolvedValueOnce([{ userId: 'a' }, { userId: 'b' }])
      .mockResolvedValue([]); // no sessions for either → only NAMS path
    searchEntities.mockResolvedValue([{ name: 'Hiking' }]);
    const res = await reconcileAll();
    expect(res.users).toBe(2);
    expect(res.written).toBe(2); // one NAMS bridge each
  });
});
