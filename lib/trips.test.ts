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
const getHomeLocation = vi.fn().mockResolvedValue(null);
vi.mock('./bridges', () => ({
  considerPark: vi.fn(),
  getHomeLocation: (...a: unknown[]) => getHomeLocation(...a),
}));
vi.mock('./conditions', () => ({ buildParkConditions: vi.fn() }));
const cachedDriveSegments = vi.fn();
vi.mock('./drive-cache', () => ({
  cachedDriveSegments: (...a: unknown[]) => cachedDriveSegments(...a),
}));

import { tripCost, tripConditions, createTrip, setTripOrigin, recomputeSegments } from './trips';
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
  beforeEach(() => getHomeLocation.mockReset().mockResolvedValue(null));

  it('stores a real ampersand, not the double-encoded entity', async () => {
    await createTrip('u1', { name: 'Four Corners Ancestral Puebloan &amp; Dark Skies' });
    // The name write is the writeGraph call whose params carry a `name`.
    const nameCall = writeGraph.mock.calls.find((c) => (c[1] as { name?: string })?.name !== undefined);
    expect(nameCall).toBeDefined();
    expect((nameCall![1] as { name: string }).name).toBe('Four Corners Ancestral Puebloan & Dark Skies');
  });

  it('defaults the origin from the saved home location, round trip on', async () => {
    getHomeLocation.mockResolvedValue({ latitude: 45.68, longitude: -111.04, label: 'Bozeman, MT, USA', source: 'geocode' });
    await createTrip('u1', { name: 'Big Loop' });
    const call = writeGraph.mock.calls.find((c) => (c[1] as { name?: string })?.name !== undefined);
    const params = call![1] as { startPoint: unknown; startLabel: string; returnToOrigin: boolean };
    expect(params.startPoint).toEqual({ latitude: 45.68, longitude: -111.04 });
    expect(params.startLabel).toBe('Bozeman, MT, USA');
    expect(params.returnToOrigin).toBe(true);
  });

  it('leaves the origin unset (no round trip) when there is no home', async () => {
    await createTrip('u1', { name: 'No Home' });
    const call = writeGraph.mock.calls.find((c) => (c[1] as { name?: string })?.name !== undefined);
    const params = call![1] as { startPoint: unknown; returnToOrigin: boolean };
    expect(params.startPoint).toBeNull();
    expect(params.returnToOrigin).toBe(false);
  });

  it('prefers an explicit startPoint over the saved home', async () => {
    getHomeLocation.mockResolvedValue({ latitude: 45.68, longitude: -111.04, label: 'Bozeman, MT, USA', source: 'geocode' });
    await createTrip('u1', { name: 'Fly-in', startPoint: { latitude: 36.08, longitude: -115.15, label: 'Las Vegas, NV' }, returnToOrigin: false });
    const call = writeGraph.mock.calls.find((c) => (c[1] as { name?: string })?.name !== undefined);
    const params = call![1] as { startPoint: { latitude: number }; startLabel: string; returnToOrigin: boolean };
    expect(params.startPoint.latitude).toBe(36.08);
    expect(params.startLabel).toBe('Las Vegas, NV');
    expect(params.returnToOrigin).toBe(false);
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

describe('setTripOrigin (ADR-074 — per-trip origin + round-trip toggle)', () => {
  beforeEach(() => {
    getHomeLocation.mockReset().mockResolvedValue(null);
    cachedDriveSegments.mockReset().mockResolvedValue([]);
  });

  it('returns false (and skips the recompute) when the trip is not the caller’s', async () => {
    writeGraph.mockResolvedValueOnce([]); // MATCH found nothing
    expect(await setTripOrigin('u1', 'nope', { origin: { latitude: 1, longitude: 2, label: 'X' } })).toBe(false);
    expect(readGraph).not.toHaveBeenCalled(); // no getTrip → no recompute
  });

  it('maps origin:null to clear=true and a set origin to a point param', async () => {
    // Call 1: the SET write. Then recomputeSegments → getTrip (readGraph, no trip → early return).
    writeGraph.mockResolvedValueOnce([{ ok: true }]);
    readGraph.mockResolvedValueOnce([]);
    await setTripOrigin('u1', 't1', { origin: null, returnToOrigin: false });
    expect(writeGraph.mock.calls[0][1]).toMatchObject({ clear: true, startPoint: null, returnToOrigin: false });

    writeGraph.mockReset().mockResolvedValueOnce([{ ok: true }]);
    readGraph.mockReset().mockResolvedValueOnce([]);
    await setTripOrigin('u1', 't1', { origin: { latitude: 45.6, longitude: -111, label: 'Bozeman' } });
    expect(writeGraph.mock.calls[0][1]).toMatchObject({
      clear: false,
      startPoint: { latitude: 45.6, longitude: -111 },
      startLabel: 'Bozeman',
      returnToOrigin: null, // toggle untouched
    });
  });
});

describe('recomputeSegments (ADR-074 — origin legs live on :Trip, DRIVE_TO stays stop-to-stop)', () => {
  const tripRow = (over: Record<string, unknown> = {}) => [{
    id: 't1', name: 'Loop', startDate: null, endDate: null,
    origin: { lat: 45.6, lng: -111.0, label: 'Bozeman' },
    returnToOrigin: true, originLeg: null, returnLeg: null,
    stops: [
      { id: 's1', order: 0, kind: 'park', parkName: 'Yellowstone', lat: 44.6, lng: -110.5 },
      { id: 's2', order: 1, kind: 'park', parkName: 'Glacier', lat: 48.7, lng: -113.8 },
    ],
    ...over,
  }];

  beforeEach(() => {
    cachedDriveSegments.mockReset();
  });

  it('writes stop DRIVE_TO edges plus origin + return legs on the trip', async () => {
    readGraph.mockResolvedValueOnce(tripRow());
    cachedDriveSegments
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 350, minutes: 330, source: 'ors' }]) // stops
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 90, minutes: 95, source: 'ors' }]) // origin→first
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 260, minutes: 250, source: 'ors' }]); // last→origin
    await recomputeSegments('u1', 't1');

    // 3 cachedDriveSegments calls: stop chain, origin leg (origin→first), return leg (last→origin).
    expect(cachedDriveSegments).toHaveBeenCalledTimes(3);
    expect(cachedDriveSegments.mock.calls[1][0]).toEqual([
      { latitude: 45.6, longitude: -111.0 },
      { latitude: 44.6, longitude: -110.5 },
    ]);
    expect(cachedDriveSegments.mock.calls[2][0]).toEqual([
      { latitude: 48.7, longitude: -113.8 },
      { latitude: 45.6, longitude: -111.0 },
    ]);
    // Final write persists both legs as :Trip props.
    const legWrite = writeGraph.mock.calls.find((c) => (c[1] as { om?: number })?.om !== undefined);
    expect(legWrite![1]).toMatchObject({ om: 90, omin: 95, osrc: 'ors', rm: 260, rmin: 250, rsrc: 'ors' });
  });

  it('skips the return leg when returnToOrigin is off, and clears legs when there is no origin', async () => {
    readGraph.mockResolvedValueOnce(tripRow({ returnToOrigin: false }));
    cachedDriveSegments
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 350, minutes: 330, source: 'ors' }])
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 90, minutes: 95, source: 'ors' }]);
    await recomputeSegments('u1', 't1');
    expect(cachedDriveSegments).toHaveBeenCalledTimes(2); // no return-leg call
    let legWrite = writeGraph.mock.calls.find((c) => (c[1] as { om?: number })?.om !== undefined);
    expect(legWrite![1]).toMatchObject({ om: 90, rm: null, rmin: null, rsrc: null });

    writeGraph.mockClear();
    readGraph.mockResolvedValueOnce(tripRow({ origin: null }));
    cachedDriveSegments.mockReset().mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 350, minutes: 330, source: 'ors' }]);
    await recomputeSegments('u1', 't1');
    legWrite = writeGraph.mock.calls.find((c) => Object.prototype.hasOwnProperty.call(c[1] as object, 'om'));
    expect(legWrite![1]).toMatchObject({ om: null, rm: null }); // stale legs never survive an origin clear
  });

  it('computes the origin leg even for a single-stop trip (no stop segments)', async () => {
    readGraph.mockResolvedValueOnce(tripRow({
      stops: [{ id: 's1', order: 0, kind: 'park', parkName: 'Yellowstone', lat: 44.6, lng: -110.5 }],
    }));
    cachedDriveSegments
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 90, minutes: 95, source: 'great_circle' }]) // origin→only stop
      .mockResolvedValueOnce([{ fromIndex: 0, toIndex: 1, miles: 90, minutes: 95, source: 'great_circle' }]); // stop→origin
    await recomputeSegments('u1', 't1');
    // located.length < 2 → NO stop-chain call; the two calls are the origin + return legs.
    expect(cachedDriveSegments).toHaveBeenCalledTimes(2);
    const legWrite = writeGraph.mock.calls.find((c) => (c[1] as { om?: number })?.om !== undefined);
    expect(legWrite![1]).toMatchObject({ om: 90, osrc: 'great_circle', rm: 90 });
  });
});
