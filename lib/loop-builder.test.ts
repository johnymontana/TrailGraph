import { describe, it, expect } from 'vitest';
import { suggestLoops, type LoopTrail, type LoopConnection } from './loop-builder';

/**
 * Loop builder (ADR-072): single loop-type trails + paired trails sharing ≥2 junctions, with recomputed
 * length/gain/Naismith time, shortest-first. Pure.
 */
const BRIGHT_ANGEL: LoopTrail = { id: 'ba', name: 'Bright Angel', lengthMiles: 9.5, elevationGainFt: 4380, elevationLossFt: 4380, routeType: 'point-to-point' };
const SOUTH_KAIBAB: LoopTrail = { id: 'sk', name: 'South Kaibab', lengthMiles: 7.0, elevationGainFt: 4780, elevationLossFt: 4780, routeType: 'point-to-point' };
const STORM_POINT: LoopTrail = { id: 'sp', name: 'Storm Point', lengthMiles: 2.3, elevationGainFt: 100, elevationLossFt: 100, routeType: 'loop' };

describe('suggestLoops', () => {
  it('surfaces a loop-type trail as a single loop', () => {
    const loops = suggestLoops([STORM_POINT], []);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ kind: 'single', trailIds: ['sp'], lengthMiles: 2.3, elevationGainFt: 100 });
    expect(loops[0].estTimeHrs).toBeGreaterThan(0);
  });

  it('pairs two trails sharing TWO junctions into one loop with summed metrics', () => {
    const conns: LoopConnection[] = [{ from: 'ba', to: 'sk', junctions: 2 }];
    const loops = suggestLoops([BRIGHT_ANGEL, SOUTH_KAIBAB], conns);
    const pair = loops.find((l) => l.kind === 'pair')!;
    expect(pair.trailIds.sort()).toEqual(['ba', 'sk']);
    expect(pair.lengthMiles).toBe(16.5); // 9.5 + 7.0
    expect(pair.elevationGainFt).toBe(9160); // 4380 + 4780
    expect(pair.estTimeHrs).toBeGreaterThan(0);
  });

  it('does NOT make a loop from a single shared junction (a chain, not a loop)', () => {
    const loops = suggestLoops([BRIGHT_ANGEL, SOUTH_KAIBAB], [{ from: 'ba', to: 'sk', junctions: 1 }]);
    expect(loops.filter((l) => l.kind === 'pair')).toHaveLength(0);
  });

  it('sorts shortest-first and respects the limit', () => {
    const conns: LoopConnection[] = [{ from: 'ba', to: 'sk', junctions: 2 }];
    const loops = suggestLoops([STORM_POINT, BRIGHT_ANGEL, SOUTH_KAIBAB], conns, { limit: 1 });
    expect(loops).toHaveLength(1);
    expect(loops[0].trailIds).toEqual(['sp']); // 2.3 mi single beats the 16.5 mi pair
  });

  it('drops a connection whose trails are not in the set (no crash, no partial loop)', () => {
    const loops = suggestLoops([BRIGHT_ANGEL], [{ from: 'ba', to: 'missing', junctions: 2 }]);
    expect(loops.filter((l) => l.kind === 'pair')).toHaveLength(0);
  });

  it('dedupes a pair that also appears via a duplicate connection', () => {
    const conns: LoopConnection[] = [
      { from: 'ba', to: 'sk', junctions: 2 },
      { from: 'ba', to: 'sk', junctions: 3 },
    ];
    const loops = suggestLoops([BRIGHT_ANGEL, SOUTH_KAIBAB], conns);
    expect(loops.filter((l) => l.kind === 'pair')).toHaveLength(1);
  });
});
