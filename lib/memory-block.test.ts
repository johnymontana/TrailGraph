import { describe, it, expect } from 'vitest';
import { renderMemoryBlock } from './memory-block';
import type { UserMemory } from './memory-graph';

/**
 * P1.4 deterministic-memory block. The block is injected into the cache-sensitive system position every
 * turn, so the invariant under test is: identical memory ⇒ identical bytes (sorted, stable), empty memory
 * ⇒ '' (inject nothing), and each populated field surfaces exactly once.
 */
function mem(over: Partial<UserMemory> = {}): UserMemory {
  return {
    preferences: [],
    considered: [],
    planned: [],
    travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] },
    passes: [],
    stamps: [],
    availability: { start: null, end: null },
    ...over,
  };
}

describe('renderMemoryBlock', () => {
  it('returns empty string for a user with no saved memory (inject nothing)', () => {
    expect(renderMemoryBlock(mem())).toBe('');
  });

  it('renders each populated field once, with the load-bearing header + recall guidance', () => {
    const out = renderMemoryBlock(
      mem({
        preferences: [
          { kind: 'topic', name: 'dark skies', category: null, value: null, feedback: null, weight: null },
          { kind: 'activity', name: 'birding', category: null, value: null, feedback: null, weight: null },
        ],
        travel: { wheelchair: true, rvMaxLengthFt: 30, requiredAmenities: ['accessible restrooms'] },
        passes: [{ id: 'p1', name: 'America the Beautiful' }],
        availability: { start: '2026-09-21', end: '2026-09-30' },
        considered: [{ parkCode: 'grba', name: 'Great Basin', source: null }],
        planned: [{ tripId: 't1', name: 'Utah Dark Skies' }],
      }),
    );
    expect(out).toContain('load-bearing');
    expect(out).toContain('- Prefers: birding, dark skies'); // sorted
    expect(out).toContain('needs wheelchair-accessible sites');
    expect(out).toContain('RV ≤ 30 ft');
    expect(out).toContain('required amenities: accessible restrooms');
    expect(out).toContain('Passes held: America the Beautiful'); // line-initial capitalize()
    expect(out).toContain('availability: 2026-09-21 → 2026-09-30');
    expect(out).toContain('- Considered parks: Great Basin');
    expect(out).toContain('- Saved trips: Utah Dark Skies');
    expect(out).toContain('do NOT call `recall_user_context` just to re-read it');
  });

  it('is deterministic — input ordering does not change the output (cache stability)', () => {
    const a = mem({
      preferences: [
        { kind: 'topic', name: 'waterfalls', category: null, value: null, feedback: null, weight: null },
        { kind: 'topic', name: 'dark skies', category: null, value: null, feedback: null, weight: null },
      ],
      considered: [
        { parkCode: 'zion', name: 'Zion', source: null },
        { parkCode: 'brca', name: 'Bryce Canyon', source: null },
      ],
    });
    const b = mem({
      preferences: [
        { kind: 'topic', name: 'dark skies', category: null, value: null, feedback: null, weight: null },
        { kind: 'topic', name: 'waterfalls', category: null, value: null, feedback: null, weight: null },
      ],
      considered: [
        { parkCode: 'brca', name: 'Bryce Canyon', source: null },
        { parkCode: 'zion', name: 'Zion', source: null },
      ],
    });
    expect(renderMemoryBlock(a)).toBe(renderMemoryBlock(b));
  });

  it('caps considered parks at 8', () => {
    const considered = Array.from({ length: 20 }, (_, i) => ({
      parkCode: `p${String(i).padStart(2, '0')}`,
      name: `Park ${String(i).padStart(2, '0')}`,
      source: null,
    }));
    const out = renderMemoryBlock(mem({ considered }));
    const line = out.split('\n').find((l) => l.startsWith('- Considered parks:')) ?? '';
    expect(line.split(',').length).toBe(8);
  });

  it('omits the constraints line entirely when there are no travel constraints', () => {
    const out = renderMemoryBlock(
      mem({ preferences: [{ kind: 'topic', name: 'lakes', category: null, value: null, feedback: null, weight: null }] }),
    );
    expect(out).not.toContain('Travel constraints:');
  });
});
