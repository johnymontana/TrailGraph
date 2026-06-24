import { describe, it, expect, vi } from 'vitest';

// bridges.ts pulls in DB/NAMS/canonicalize at import; stub them so the pure mergeConstraints can be
// tested without I/O (mirrors the unit-test convention in trips.test.ts).
vi.mock('./neo4j', () => ({ writeGraph: vi.fn(), readGraph: vi.fn() }));
vi.mock('./memory', () => ({ memory: {} }));
vi.mock('./canonicalize', () => ({ canonicalizeValue: vi.fn() }));
vi.mock('./tombstone', () => ({
  preferenceSignature: vi.fn(),
  suppress: vi.fn(),
  isSuppressed: vi.fn(),
}));

import { mergeConstraints, type TravelConstraints } from './bridges';

const NONE: TravelConstraints = { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] };

describe('mergeConstraints (R5 §2.2 — trip-scoped over durable)', () => {
  it('applies a one-trip need when the user has none saved (the over-persistence fix)', () => {
    const merged = mergeConstraints(NONE, { wheelchair: true });
    expect(merged.wheelchair).toBe(true);
    // …and the saved set is untouched: a later search with no override stays unconstrained.
    expect(mergeConstraints(NONE, {}).wheelchair).toBe(false);
  });

  it('per-query scalars take precedence over saved', () => {
    const saved: TravelConstraints = { wheelchair: false, rvMaxLengthFt: 40, requiredAmenities: [] };
    expect(mergeConstraints(saved, { rvMaxLengthFt: 28 }).rvMaxLengthFt).toBe(28);
  });

  it('falls back to saved scalars when no override is given', () => {
    const saved: TravelConstraints = { wheelchair: true, rvMaxLengthFt: 30, requiredAmenities: [] };
    expect(mergeConstraints(saved, {})).toEqual(saved);
  });

  it('unions required amenities and de-dupes', () => {
    const saved: TravelConstraints = { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: ['Accessible Restrooms'] };
    const merged = mergeConstraints(saved, { requiredAmenities: ['Accessible Restrooms', 'Accessible Sites'] });
    expect(merged.requiredAmenities).toEqual(['Accessible Restrooms', 'Accessible Sites']);
  });
});
