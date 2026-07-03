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
    trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false },
    trailHistory: { saved: [], wishlisted: [], done: [] },
    campPreferences: { rig: null, maxLengthFt: null, hookups: null, tentOk: false, ada: false, pets: false, quiet: false, budget: null },
    campHistory: { saved: [] },
    home: { label: null, latitude: null, longitude: null },
    ...over,
  };
}

describe('renderMemoryBlock', () => {
  it('returns empty string for a user with no saved memory (inject nothing)', () => {
    expect(renderMemoryBlock(mem())).toBe('');
  });

  it('renders the home location line (trip-origin default)', () => {
    const out = renderMemoryBlock(mem({ home: { label: 'Bozeman, MT, USA', latitude: 45.68, longitude: -111.04 } }));
    expect(out).toContain('- Home: Bozeman, MT, USA (default trip start point)');
    // Coordinates are for ranking/routing, never the prompt.
    expect(out).not.toContain('45.68');
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

  it('renders camp preferences + saved campgrounds (Campgrounds feature)', () => {
    const out = renderMemoryBlock(
      mem({
        campPreferences: { rig: 'rv', maxLengthFt: 28, hookups: '30amp', tentOk: false, ada: false, pets: true, quiet: true, budget: 30 },
        campHistory: { saved: [{ id: 'cg-canyon', name: 'Canyon Campground' }] },
      }),
    );
    expect(out).toContain('- Camp preferences: 28-ft rv · 30amp · pets · quiet · ≤ $30');
    expect(out).toContain('- Saved campgrounds: Canyon Campground');
  });

  it('camp-preferences line is byte-stable + omitted when empty', () => {
    expect(renderMemoryBlock(mem())).not.toContain('Camp preferences');
    const a = mem({ campPreferences: { rig: 'tent', maxLengthFt: null, hookups: null, tentOk: true, ada: true, pets: false, quiet: false, budget: null } });
    expect(renderMemoryBlock(a)).toBe(renderMemoryBlock({ ...a }));
    expect(renderMemoryBlock(a)).toContain('- Camp preferences: tent · tent ok · ADA');
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

  it('summarizes a single constraint without dangling separators', () => {
    expect(renderMemoryBlock(mem({ travel: { wheelchair: true, rvMaxLengthFt: null, requiredAmenities: [] } })))
      .toContain('Travel constraints: needs wheelchair-accessible sites');
    const rvOnly = renderMemoryBlock(mem({ travel: { wheelchair: false, rvMaxLengthFt: 28, requiredAmenities: [] } }));
    expect(rvOnly).toContain('Travel constraints: RV ≤ 28 ft');
    expect(rvOnly).not.toContain('·'); // no leading/trailing separator for a single item
    expect(renderMemoryBlock(mem({ travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: ['flush toilets'] } })))
      .toContain('required amenities: flush toilets');
  });

  it('renders partial availability windows (start-only / end-only)', () => {
    // Availability is the line-initial clause here, so capitalize() uppercases it ("Availability:").
    expect(renderMemoryBlock(mem({ availability: { start: '2026-09-21', end: null } }))).toContain('Availability: from 2026-09-21');
    expect(renderMemoryBlock(mem({ availability: { start: null, end: '2026-09-30' } }))).toContain('Availability: until 2026-09-30');
  });

  it('renders a passes-only user (no availability) without an empty availability clause', () => {
    const out = renderMemoryBlock(mem({ passes: [{ id: 'atb', name: 'America the Beautiful' }] }));
    expect(out).toContain('Passes held: America the Beautiful');
    expect(out).not.toContain('availability:');
  });

  it('renders trail preferences and saved / hiked trails (sorted, capped) once each', () => {
    const out = renderMemoryBlock(
      mem({
        trailPreferences: { maxMiles: 6, maxGainFt: 2500, difficulty: 'moderate', avoidExposure: true, dogsRequired: false },
        trailHistory: {
          saved: [{ id: 't2', name: 'Bright Angel' }],
          wishlisted: [{ id: 't1', name: 'Angels Landing' }],
          done: [{ id: 't3', name: 'South Kaibab' }],
        },
      }),
    );
    // preference summary, ordered difficulty → miles → gain → exposure. Gain is raw (no locale grouping)
    // so the cache-stable block is byte-identical across runtime locales.
    expect(out).toContain('- Trail preferences: moderate or easier · ≤ 6 mi · ≤ 2500 ft gain · no exposure');
    // saved + wishlisted merged and sorted; done is its own line
    expect(out).toContain('- Saved / bucket-list trails: Angels Landing, Bright Angel');
    expect(out).toContain('- Trails already hiked: South Kaibab');
  });

  it('dedupes a trail that is both saved and wishlisted (no double-render, no wasted cap slot)', () => {
    const out = renderMemoryBlock(
      mem({
        trailHistory: {
          saved: [{ id: 't1', name: 'Angels Landing' }],
          wishlisted: [{ id: 't1', name: 'Angels Landing' }, { id: 't2', name: 'Bright Angel' }],
          done: [],
        },
      }),
    );
    const line = out.split('\n').find((l) => l.startsWith('- Saved / bucket-list trails:')) ?? '';
    expect(line).toBe('- Saved / bucket-list trails: Angels Landing, Bright Angel'); // each once, sorted
  });

  it('omits trail lines entirely when there is no trail memory', () => {
    const out = renderMemoryBlock(mem({ preferences: [{ kind: 'topic', name: 'lakes', category: null, value: null, feedback: null, weight: null }] }));
    expect(out).not.toContain('Trail preferences:');
    expect(out).not.toContain('bucket-list trails');
  });

  it('sorts passes so identical holdings render identically (cache stability)', () => {
    const a = renderMemoryBlock(mem({ passes: [{ id: '2', name: 'Zion' }, { id: '1', name: 'Acadia' }] }));
    const b = renderMemoryBlock(mem({ passes: [{ id: '1', name: 'Acadia' }, { id: '2', name: 'Zion' }] }));
    expect(a).toBe(b);
    expect(a).toContain('Passes held: Acadia, Zion');
  });
});
