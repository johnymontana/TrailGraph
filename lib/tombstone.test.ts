import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const writeGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a), writeGraph: (...a: unknown[]) => writeGraph(...a) }));

import { preferenceSignature, isSuppressed, suppress } from './tombstone';

beforeEach(() => {
  readGraph.mockReset();
  writeGraph.mockReset();
});

describe('preferenceSignature', () => {
  it('is stable, lowercased, and trimmed for a kind+name', () => {
    expect(preferenceSignature('activity', '  Hiking ')).toBe('pref:activity:hiking');
    expect(preferenceSignature('activity', 'HIKING')).toBe(preferenceSignature('activity', 'hiking'));
  });

  it('distinguishes different kinds for the same name', () => {
    expect(preferenceSignature('activity', 'Lakes')).not.toBe(preferenceSignature('topic', 'Lakes'));
  });
});

describe('isSuppressed', () => {
  it('returns the boolean from the EXISTS query', async () => {
    readGraph.mockResolvedValue([{ ok: true }]);
    expect(await isSuppressed('u1', 'pref:topic:lakes')).toBe(true);
  });

  it('defaults to false when no row comes back', async () => {
    readGraph.mockResolvedValue([]);
    expect(await isSuppressed('u1', 'pref:topic:lakes')).toBe(false);
  });
});

describe('suppress', () => {
  it('writes a userId-scoped DeletedFact tombstone', async () => {
    writeGraph.mockResolvedValue(undefined);
    await suppress('u1', 'pref:activity:hiking');
    expect(writeGraph).toHaveBeenCalledTimes(1);
    const [, params] = writeGraph.mock.calls[0];
    expect(params).toEqual({ userId: 'u1', signature: 'pref:activity:hiking' });
  });
});
