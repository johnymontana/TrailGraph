import { describe, it, expect, vi, beforeEach } from 'vitest';

// tripCost is the pure-ish cost model on top of two readGraph calls; mock the I/O deps so the
// fee-parsing + America-the-Beautiful break-even logic can be unit-tested without a DB.
const readGraph = vi.fn();
const writeGraph = vi.fn().mockResolvedValue([]);
vi.mock('./neo4j', () => ({
  readGraph: (...a: unknown[]) => readGraph(...a),
  writeGraph: (...a: unknown[]) => writeGraph(...a),
}));
vi.mock('./routing', () => ({ routing: {} }));
vi.mock('./bridges', () => ({ considerPark: vi.fn() }));
vi.mock('./conditions', () => ({ buildParkConditions: vi.fn() }));

import { tripCost, tripConditions, createTrip } from './trips';
import { buildParkConditions } from './conditions';

beforeEach(() => {
  readGraph.mockReset();
  writeGraph.mockReset().mockResolvedValue([]);
});

describe('tripCost (P2 fees / break-even cost model)', () => {
  it('sums the max line per park and reports no AtB savings under $80', async () => {
    readGraph
      .mockResolvedValueOnce([
        { parkCode: 'yell', parkName: 'Yellowstone', fees: JSON.stringify([{ cost: '35' }, { cost: '20' }]) },
        { parkCode: 'grca', parkName: 'Grand Canyon', fees: JSON.stringify([{ cost: '35' }]) },
        { parkCode: 'glac', parkName: 'Glacier', fees: null },
      ])
      .mockResolvedValueOnce([]); // user does not hold the annual pass
    const c = await tripCost('u1', 't1');
    expect(c.perPark).toEqual([
      { parkCode: 'yell', parkName: 'Yellowstone', fee: 35 },
      { parkCode: 'grca', parkName: 'Grand Canyon', fee: 35 },
      { parkCode: 'glac', parkName: 'Glacier', fee: 0 },
    ]);
    expect(c.total).toBe(70);
    expect(c.holdsAtb).toBe(false);
    expect(c.atbSaves).toBe(false); // 70 < 80
  });

  it('flags AtB savings once gross fees exceed the $80 pass', async () => {
    readGraph
      .mockResolvedValueOnce([
        { parkCode: 'a', parkName: 'A', fees: JSON.stringify([{ cost: '35' }]) },
        { parkCode: 'b', parkName: 'B', fees: JSON.stringify([{ cost: '35' }]) },
        { parkCode: 'c', parkName: 'C', fees: JSON.stringify([{ cost: '35' }]) },
      ])
      .mockResolvedValueOnce([]);
    const c = await tripCost('u1', 't1');
    expect(c.atbSaves).toBe(true); // 105 > 80
  });

  it('zeroes the total when the user already holds the annual pass', async () => {
    readGraph
      .mockResolvedValueOnce([{ parkCode: 'yell', parkName: 'Yellowstone', fees: JSON.stringify([{ cost: '35' }]) }])
      .mockResolvedValueOnce([{ ok: true }]);
    const c = await tripCost('u1', 't1');
    expect(c.holdsAtb).toBe(true);
    expect(c.total).toBe(0);
  });

  it('treats malformed fee JSON as $0 rather than throwing', async () => {
    readGraph
      .mockResolvedValueOnce([{ parkCode: 'x', parkName: 'X', fees: 'not-json' }])
      .mockResolvedValueOnce([]);
    const c = await tripCost('u1', 't1');
    expect(c.perPark[0].fee).toBe(0);
    expect(c.total).toBe(0);
  });
});

describe('createTrip (R5 §2.1 — decode model HTML entities at the write boundary)', () => {
  it('stores a real ampersand, not the double-encoded entity', async () => {
    await createTrip('u1', { name: 'Four Corners Ancestral Puebloan &amp; Dark Skies' });
    // The name write is the writeGraph call whose params carry a `name`.
    const nameCall = writeGraph.mock.calls.find((c) => (c[1] as { name?: string })?.name !== undefined);
    expect(nameCall).toBeDefined();
    expect((nameCall![1] as { name: string }).name).toBe('Four Corners Ancestral Puebloan & Dark Skies');
  });
});

describe('tripConditions (Trip Dashboard aggregation, ADR-042)', () => {
  beforeEach(() => vi.mocked(buildParkConditions).mockReset());

  it('returns null when the trip does not exist', async () => {
    readGraph.mockResolvedValueOnce([]); // getTrip → no rows
    expect(await tripConditions('u1', 'nope')).toBeNull();
  });

  it('aggregates only park stops, in order, ignoring non-park stops', async () => {
    readGraph.mockResolvedValueOnce([
      {
        id: 't1', name: 'Loop', startDate: null, endDate: null,
        stops: [
          { id: 's1', order: 0, kind: 'park', parkCode: 'yell', parkName: 'Yellowstone', lat: 1, lng: 2 },
          { id: 's2', order: 1, kind: 'custom', name: 'Hotel', lat: 3, lng: 4 }, // not a park → skipped
          { id: 's3', order: 2, kind: 'park', parkCode: 'grca', parkName: 'Grand Canyon', lat: 5, lng: 6 },
        ],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(buildParkConditions).mockImplementation(async (code: string, order?: number) => ({ parkCode: code, parkName: code, order } as any));
    const dash = await tripConditions('u1', 't1');
    expect(dash!.tripId).toBe('t1');
    expect(dash!.stops.map((s) => s.parkCode)).toEqual(['yell', 'grca']);
    expect(buildParkConditions).toHaveBeenCalledTimes(2);
  });

  it('filters out stops whose conditions could not be built (e.g. a since-deleted park)', async () => {
    readGraph.mockResolvedValueOnce([
      {
        id: 't1', name: 'Loop', startDate: null, endDate: null,
        stops: [
          { id: 's1', order: 0, kind: 'park', parkCode: 'yell', parkName: 'Y', lat: 1, lng: 2 },
          { id: 's2', order: 1, kind: 'park', parkCode: 'gone', parkName: 'G', lat: 3, lng: 4 },
        ],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(buildParkConditions).mockImplementation(async (code: string) => (code === 'gone' ? null : ({ parkCode: code } as any)));
    const dash = await tripConditions('u1', 't1');
    expect(dash!.stops.map((s) => s.parkCode)).toEqual(['yell']);
  });
});
