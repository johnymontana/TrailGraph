import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const writeGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a), writeGraph: (...a: unknown[]) => writeGraph(...a) }));

import { preferenceSignature, learningSignature, isSuppressed, suppress } from './tombstone';

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

describe('learningSignature (Ranger School)', () => {
  it('is namespaced under learn:, kind-qualified, lowercased + trimmed', () => {
    expect(learningSignature('struggle:topic', '  Volcanoes ')).toBe('learn:struggle:topic:volcanoes');
    expect(learningSignature('earned:badge', 'Geologist')).toBe('learn:earned:badge:geologist');
  });

  it('never collides with a preference signature or across learning kinds', () => {
    // bare-name collision the gotcha warns about is avoided by the kind qualifier + learn: namespace
    expect(learningSignature('struggle:topic', 'Volcanoes')).not.toBe(preferenceSignature('topic', 'Volcanoes'));
    expect(learningSignature('struggle:topic', 'Geology')).not.toBe(learningSignature('earned:badge', 'Geology'));
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
