import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a) }));

import { getUserMemory, userContextBridges } from './memory-graph';

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
      trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false },
      trailHistory: { saved: [], wishlisted: [], done: [] },
    });
  });
});

describe('userContextBridges (#8 — you-in-the-graph bridges)', () => {
  it('short-circuits with no DB call when there are no park codes', async () => {
    expect(await userContextBridges('u1', [])).toEqual([]);
    expect(readGraph).not.toHaveBeenCalled();
  });

  it('concatenates pref + trip + stamp bridges and caps the total', async () => {
    // Promise.all order: prefs, trips, stamps.
    readGraph
      .mockResolvedValueOnce([{ fromKind: 'activity', fromKey: 'Hiking', via: 'OFFERS', parkCode: 'yell' }])
      .mockResolvedValueOnce([{ fromKind: 'trip', fromKey: 't1', via: 'INCLUDES', parkCode: 'grca' }])
      .mockResolvedValueOnce([{ fromKind: 'stamp', fromKey: 's1', via: 'AT', parkCode: 'zion' }]);
    const out = await userContextBridges('u1', ['yell', 'grca', 'zion']);
    expect(out).toEqual([
      { fromKind: 'activity', fromKey: 'Hiking', via: 'OFFERS', parkCode: 'yell' },
      { fromKind: 'trip', fromKey: 't1', via: 'INCLUDES', parkCode: 'grca' },
      { fromKind: 'stamp', fromKey: 's1', via: 'AT', parkCode: 'zion' },
    ]);
    // pref query received the per-pref cap + scoped park codes
    const prefParams = readGraph.mock.calls[0][1] as { perPrefCap: number; parkCodes: string[] };
    expect(prefParams.perPrefCap).toBe(40);
    expect(prefParams.parkCodes).toEqual(['yell', 'grca', 'zion']);
  });

  it('respects the global maxBridges cap', async () => {
    readGraph
      .mockResolvedValueOnce([
        { fromKind: 'activity', fromKey: 'a', via: 'OFFERS', parkCode: 'p1' },
        { fromKind: 'activity', fromKey: 'b', via: 'OFFERS', parkCode: 'p2' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const out = await userContextBridges('u1', ['p1', 'p2'], { maxBridges: 1 });
    expect(out).toHaveLength(1);
  });
});
