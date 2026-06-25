import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-logic test: stub I/O deps so importing the module never touches a driver/canonicalize/tombstone.
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('./canonicalize', () => ({ canonicalizeValue: vi.fn() }));
vi.mock('./tombstone', () => ({ learningSignature: vi.fn(), isSuppressed: vi.fn(), suppress: vi.fn() }));

import {
  clamp01,
  ewma,
  recordStruggle,
  recordMastery,
  earnBadge,
  completeLesson,
  issueCertificate,
  deleteStruggle,
} from './learning-bridges';
import { readGraph, writeGraph } from './neo4j';
import { canonicalizeValue } from './canonicalize';
import { learningSignature, isSuppressed, suppress } from './tombstone';

const readGraphMock = vi.mocked(readGraph);
const writeGraphMock = vi.mocked(writeGraph);
const canonicalizeValueMock = vi.mocked(canonicalizeValue);
const learningSignatureMock = vi.mocked(learningSignature);
const isSuppressedMock = vi.mocked(isSuppressed);
const suppressMock = vi.mocked(suppress);

/** Reset all I/O mocks between cases so call counts/order assertions are independent. */
beforeEach(() => {
  vi.clearAllMocks();
});

describe('clamp01', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(2.3)).toBe(1);
  });
  it('treats non-finite input as 0 (safe default for garbage)', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });
});

describe('ewma (mastery)', () => {
  it('returns the sample on first observation (previous=null)', () => {
    expect(ewma(null, 1)).toBe(1);
    expect(ewma(null, 0)).toBe(0);
  });
  it('blends toward the new sample with default alpha 0.3', () => {
    // 0.3*1 + 0.7*0 = 0.3
    expect(ewma(0, 1)).toBeCloseTo(0.3, 6);
    // 0.3*0 + 0.7*1 = 0.7
    expect(ewma(1, 0)).toBeCloseTo(0.7, 6);
  });
  it('honors a custom alpha and stays clamped to [0,1]', () => {
    expect(ewma(0.5, 0.5, 0.9)).toBeCloseTo(0.5, 6);
    expect(ewma(2, 2)).toBe(1); // clamps both previous + sample
    expect(ewma(-1, -1)).toBe(0);
  });
});

describe('recordStruggle (canonicalize + tombstone gate)', () => {
  it('returns false and writes nothing when the topic does not canonicalize', async () => {
    // (a) outright miss
    canonicalizeValueMock.mockResolvedValueOnce(null);
    expect(await recordStruggle('u1', 'gibberish', 0.9)).toBe(false);
    // (b) canonicalizes but to a non-topic (activity) — must NOT be laundered into a STRUGGLES_WITH edge
    canonicalizeValueMock.mockResolvedValueOnce({ kind: 'activity', name: 'Hiking', method: 'exact' });
    expect(await recordStruggle('u1', 'hiking', 0.9)).toBe(false);

    // the `target?.kind !== 'topic'` guard short-circuits BEFORE any I/O
    expect(writeGraphMock).not.toHaveBeenCalled();
    expect(isSuppressedMock).not.toHaveBeenCalled();
  });

  it('short-circuits to false (no write) when the struggle is tombstone-suppressed', async () => {
    canonicalizeValueMock.mockResolvedValue({ kind: 'topic', name: 'Volcanoes', method: 'exact' });
    learningSignatureMock.mockReturnValue('learn:struggle:topic:volcanoes');
    isSuppressedMock.mockResolvedValueOnce(true);

    expect(await recordStruggle('u1', 'volcanoes', 0.5)).toBe(false);
    // checked the right signature (kind 'struggle:topic', canonical name)
    expect(learningSignatureMock).toHaveBeenCalledWith('struggle:topic', 'Volcanoes');
    expect(isSuppressedMock).toHaveBeenCalledWith('u1', 'learn:struggle:topic:volcanoes');
    expect(writeGraphMock).not.toHaveBeenCalled();

    // flip suppression off → the edge IS written and we return true
    isSuppressedMock.mockResolvedValueOnce(false);
    writeGraphMock.mockResolvedValueOnce([] as never);
    expect(await recordStruggle('u1', 'volcanoes', 0.5)).toBe(true);
    expect(writeGraphMock).toHaveBeenCalledTimes(1);
    expect(writeGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', name: 'Volcanoes', confidence: 0.5 });
  });

  it('clamps confidence into [0,1] before writing', async () => {
    canonicalizeValueMock.mockResolvedValue({ kind: 'topic', name: 'Volcanoes', method: 'exact' });
    isSuppressedMock.mockResolvedValue(false);
    writeGraphMock.mockResolvedValue([] as never);

    await recordStruggle('u1', 'volcanoes', 1.7);
    expect((writeGraphMock.mock.calls[0][1] as { confidence: number }).confidence).toBe(1);

    await recordStruggle('u1', 'volcanoes', -0.4);
    expect((writeGraphMock.mock.calls[1][1] as { confidence: number }).confidence).toBe(0);
  });
});

describe('recordMastery (EWMA over prior MASTERY edge)', () => {
  it('returns null and skips both read + write when the topic does not canonicalize', async () => {
    canonicalizeValueMock.mockResolvedValueOnce(null);
    expect(await recordMastery('u1', 'nope', 1)).toBeNull();
    expect(readGraphMock).not.toHaveBeenCalled();
    expect(writeGraphMock).not.toHaveBeenCalled();
  });

  it('seeds the EWMA with the sample on first observation, then blends on the next', async () => {
    canonicalizeValueMock.mockResolvedValue({ kind: 'topic', name: 'Volcanoes', method: 'exact' });
    writeGraphMock.mockResolvedValue([] as never);

    // first observation: no prior MASTERY edge → ewma(null, x) === x
    readGraphMock.mockResolvedValueOnce([] as never);
    const first = await recordMastery('u1', 'volcanoes', 0.6);
    expect(first).toEqual({ previous: null, score: 0.6 });
    expect((writeGraphMock.mock.calls[0][1] as { score: number }).score).toBe(0.6);

    // second observation: prior score 0 + sample 1 → 0.3*1 + 0.7*0 = 0.3
    readGraphMock.mockResolvedValueOnce([{ previous: 0 }] as never);
    const second = await recordMastery('u1', 'volcanoes', 1);
    expect(second?.previous).toBe(0);
    expect(second?.score).toBeCloseTo(0.3, 6);
    expect((writeGraphMock.mock.calls[1][1] as { score: number }).score).toBeCloseTo(0.3, 6);
  });
});

describe('earnBadge (newlyEarned flag passthrough)', () => {
  it('returns the query newlyEarned flag and defaults to false on an empty result', async () => {
    writeGraphMock.mockResolvedValueOnce([{ newlyEarned: true }] as never);
    expect(await earnBadge('u1', 'badge:first-lesson')).toBe(true);

    writeGraphMock.mockResolvedValueOnce([{ newlyEarned: false }] as never);
    expect(await earnBadge('u1', 'badge:first-lesson')).toBe(false);

    // no row (badge id not found) → the `?? false` default
    writeGraphMock.mockResolvedValueOnce([] as never);
    expect(await earnBadge('u1', 'badge:missing')).toBe(false);

    // params forwarded on every call
    for (const call of writeGraphMock.mock.calls) {
      expect(call[1]).toMatchObject({ userId: 'u1' });
      expect((call[1] as { badgeId: string }).badgeId).toMatch(/^badge:/);
    }
  });
});

describe('completeLesson / issueCertificate (score clamp + share slug)', () => {
  it('completeLesson clamps the score param before writing', async () => {
    writeGraphMock.mockResolvedValue([] as never);
    await completeLesson('u1', 'l1', 1.5);
    expect((writeGraphMock.mock.calls[0][1] as { score: number }).score).toBe(1);
  });

  it('issueCertificate clamps score, generates a 16-char hex shareSlug, and returns the row', async () => {
    const row = { id: 'cert:u1:lp1', shareSlug: 'abc', score: 0, issuedAt: '2026-06-25T00:00:00Z' };
    writeGraphMock.mockResolvedValueOnce([row] as never);

    const result = await issueCertificate('u1', 'lp1', -0.2);
    expect(result).toEqual(row);

    const params = writeGraphMock.mock.calls[0][1] as { score: number; shareSlug: string; certId: string };
    expect(params.score).toBe(0); // clamp01(-0.2)
    expect(params.shareSlug).toMatch(/^[0-9a-f]{16}$/); // randomUUID hyphens stripped, first 16 chars
    expect(params.certId).toBe('cert:u1:lp1');
  });

  it('issueCertificate returns null when the lesson plan is absent (no row)', async () => {
    writeGraphMock.mockResolvedValueOnce([] as never);
    expect(await issueCertificate('u1', 'missing', 0.5)).toBeNull();
  });
});

describe('deleteStruggle (tombstone-before-delete ordering)', () => {
  it('suppresses with the topic-name signature BEFORE deleting the edge', async () => {
    learningSignatureMock.mockReturnValue('learn:struggle:topic:volcanoes');
    suppressMock.mockResolvedValue(undefined as never);
    writeGraphMock.mockResolvedValue([] as never);

    await deleteStruggle('u1', 'Volcanoes');

    expect(learningSignatureMock).toHaveBeenCalledWith('struggle:topic', 'Volcanoes');
    expect(suppressMock).toHaveBeenCalledWith('u1', 'learn:struggle:topic:volcanoes');
    expect(writeGraphMock.mock.calls[0][1]).toEqual({ userId: 'u1', name: 'Volcanoes' });

    // suppress must land before the DELETE (else reconciliation could resurrect it mid-delete)
    const suppressOrder = suppressMock.mock.invocationCallOrder[0];
    const deleteOrder = writeGraphMock.mock.invocationCallOrder[0];
    expect(suppressOrder).toBeLessThan(deleteOrder);
  });
});
