import { describe, it, expect } from 'vitest';
import { validateSqm, SQM_MIN, SQM_MAX } from './readings';
import { normalizeCrowdCurve } from './datasources/visitation';

describe('validateSqm (ADR-053)', () => {
  it('accepts values within the measurable range', () => {
    expect(validateSqm(21.6).ok).toBe(true);
    expect(validateSqm(SQM_MIN).ok).toBe(true);
    expect(validateSqm(SQM_MAX).ok).toBe(true);
  });
  it('rejects out-of-range and non-numbers', () => {
    expect(validateSqm(10).ok).toBe(false);
    expect(validateSqm(25).ok).toBe(false);
    expect(validateSqm(Number.NaN).ok).toBe(false);
    expect(validateSqm(15.9).ok).toBe(false);
  });
});

describe('normalizeCrowdCurve (ADR-053)', () => {
  it('scales each month to a 0–100 share of the busiest month', () => {
    const monthly = [10, 20, 30, 40, 50, 60, 100, 90, 80, 70, 25, 15];
    const curve = normalizeCrowdCurve(monthly);
    expect(curve).toHaveLength(12);
    expect(curve[6].pct).toBe(100); // July is the peak
    expect(curve[0].pct).toBe(10); // Jan = 10/100
    expect(curve[0].label).toBe('Jan');
    expect(curve.every((p) => p.pct >= 0 && p.pct <= 100)).toBe(true);
  });
  it('returns [] for a non-12-length array', () => {
    expect(normalizeCrowdCurve([1, 2, 3])).toEqual([]);
    expect(normalizeCrowdCurve([])).toEqual([]);
  });
});
