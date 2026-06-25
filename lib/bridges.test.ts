import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { mergeConstraints, removeRequiredAmenity, type TravelConstraints } from './bridges';
import { writeGraph } from './neo4j';

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

describe('removeRequiredAmenity (P0.5 — per-row removal on /me)', () => {
  const mockWrite = vi.mocked(writeGraph);
  beforeEach(() => mockWrite.mockReset());

  it('deletes exactly the one REQUIRES edge by amenity name, never the shared Amenity node', async () => {
    await removeRequiredAmenity('user-1', 'Audio Description');
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [cypher, params] = mockWrite.mock.calls[0] as [string, Record<string, unknown>];
    expect(cypher).toContain('[r:REQUIRES]->(:Amenity {name:$name})');
    expect(cypher).toContain('DELETE r');
    expect(cypher).not.toContain('DETACH'); // the Amenity node is shared across users — only drop the edge
    expect(params).toEqual({ userId: 'user-1', name: 'Audio Description' });
  });
});
