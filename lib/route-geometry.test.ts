import { describe, it, expect } from 'vitest';
import { lineSlice, type Coord } from './route-geometry';

// An L-shaped polyline: (0,0)→(10,0)→(10,10), total length 20.
const line: Coord[] = [
  [0, 0],
  [10, 0],
  [10, 10],
];

describe('lineSlice (route-draw clip-by-progress)', () => {
  it('frac >= 1 returns the full line; frac <= 0 returns just the start', () => {
    expect(lineSlice(line, 1)).toEqual(line);
    expect(lineSlice(line, 1.5)).toEqual(line);
    expect(lineSlice(line, 0)).toEqual([[0, 0]]);
    expect(lineSlice(line, -0.3)).toEqual([[0, 0]]);
  });

  it('interpolates the endpoint within the segment at the target length', () => {
    expect(lineSlice(line, 0.25)).toEqual([[0, 0], [5, 0]]); // 25% of 20 = 5 along seg 1
    expect(lineSlice(line, 0.5)).toEqual([[0, 0], [10, 0]]); // 50% = 10 → exactly the first vertex
    expect(lineSlice(line, 0.75)).toEqual([[0, 0], [10, 0], [10, 5]]); // 75% = 15 → 5 into seg 2
  });

  it('handles degenerate inputs without throwing', () => {
    expect(lineSlice([], 0.5)).toEqual([]);
    expect(lineSlice([[1, 1]], 0.5)).toEqual([[1, 1]]); // <2 coords → returned as-is
    expect(lineSlice([[0, 0], [0, 0]], 0.5)).toEqual([[0, 0], [0, 0]]); // zero-length segment, no NaN
  });
});
