import { describe, it, expect, vi, beforeEach } from 'vitest';

// tripCost is the pure-ish cost model on top of two readGraph calls; mock the I/O deps so the
// fee-parsing + America-the-Beautiful break-even logic can be unit-tested without a DB.
const readGraph = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a), writeGraph: vi.fn() }));
vi.mock('./routing', () => ({ routing: {} }));
vi.mock('./bridges', () => ({ considerPark: vi.fn() }));

import { tripCost } from './trips';

beforeEach(() => readGraph.mockReset());

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
