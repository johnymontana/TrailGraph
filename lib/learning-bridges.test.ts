import { describe, it, expect, vi } from 'vitest';

// Pure-logic test: stub I/O deps so importing the module never touches a driver/canonicalize/tombstone.
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('./canonicalize', () => ({ canonicalizeValue: vi.fn() }));
vi.mock('./tombstone', () => ({ learningSignature: vi.fn(), isSuppressed: vi.fn(), suppress: vi.fn() }));

import { clamp01, ewma } from './learning-bridges';

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
