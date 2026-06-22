import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));

import { getUserMemory } from './memory-graph';

beforeEach(() => readGraph.mockReset());

describe('getUserMemory (E3 — context subgraph read)', () => {
  it('returns preferences, considered parks, and planned trips, filtering empties', async () => {
    readGraph.mockResolvedValue([
      {
        preferences: [
          { kind: 'activity', name: 'Hiking', category: 'activity', value: 'easy hikes', feedback: null },
          { kind: 'topic', name: null, category: null, value: null, feedback: null }, // OPTIONAL no-match
        ],
        considered: [
          { parkCode: 'yell', name: 'Yellowstone National Park', source: 'agent_recommendation' },
          { parkCode: null, name: null, source: null },
        ],
        planned: [
          { tripId: 't1', name: 'Loop' },
          { tripId: null, name: null },
        ],
      },
    ]);
    const mem = await getUserMemory('u1');
    expect(mem.preferences).toEqual([
      { kind: 'activity', name: 'Hiking', category: 'activity', value: 'easy hikes', feedback: null },
    ]);
    expect(mem.considered).toEqual([
      { parkCode: 'yell', name: 'Yellowstone National Park', source: 'agent_recommendation' },
    ]);
    expect(mem.planned).toEqual([{ tripId: 't1', name: 'Loop' }]);
  });

  it('returns empty arrays for a user with no memory', async () => {
    readGraph.mockResolvedValue([]);
    expect(await getUserMemory('u1')).toEqual({
      preferences: [],
      considered: [],
      planned: [],
      travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] },
      passes: [],
      stamps: [],
      availability: { start: null, end: null },
    });
  });
});
