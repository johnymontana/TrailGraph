import { describe, it, expect } from 'vitest';
import {
  shenandoahRating,
  difficultyBand,
  naismithHours,
  gradeTrail,
} from './trail-difficulty';

describe('shenandoahRating (ADR-069)', () => {
  it('computes sqrt(2 · gain · length)', () => {
    expect(shenandoahRating(5, 1000)).toBe(100); // sqrt(2*1000*5)=sqrt(10000)=100
    expect(shenandoahRating(0, 0)).toBe(0);
  });
  it('is monotonic in length and gain', () => {
    expect(shenandoahRating(6, 1000)).toBeGreaterThan(shenandoahRating(5, 1000));
    expect(shenandoahRating(5, 2000)).toBeGreaterThan(shenandoahRating(5, 1000));
  });
  it('clamps negatives to zero', () => {
    expect(shenandoahRating(-3, -100)).toBe(0);
  });
});

describe('difficultyBand', () => {
  it('bands by the Shenandoah cutoffs (<50 / 50–100 / >100)', () => {
    expect(difficultyBand(40)).toBe('easy');
    expect(difficultyBand(75)).toBe('moderate');
    expect(difficultyBand(150)).toBe('strenuous');
  });
  it('bumps one step for technical trails (sac_scale ≥ 4 or primitive class ≤ 1)', () => {
    expect(difficultyBand(40, { sacScale: 5 })).toBe('moderate');
    expect(difficultyBand(75, { trailClass: 1 })).toBe('strenuous');
    expect(difficultyBand(40, { trailClass: 3 })).toBe('easy'); // developed → no bump
  });
});

describe('naismithHours', () => {
  it('applies 1hr/3mi + 1hr/2000ft ascent', () => {
    expect(naismithHours(6, 2000)).toBe(3); // 6/3 + 2000/2000 = 2 + 1
    expect(naismithHours(3, 0)).toBe(1);
  });
  it('adds a gentle term for net-descent hikes', () => {
    expect(naismithHours(4, 0, 4000)).toBeGreaterThan(naismithHours(4, 0, 0));
  });
});

describe('gradeTrail (combined)', () => {
  it('returns rating + band + est. time together', () => {
    const g = gradeTrail({ lengthMiles: 5, elevationGainFt: 1000 });
    expect(g.difficultyRating).toBe(100);
    expect(g.difficulty).toBe('strenuous'); // rating 100 is not < 100
    expect(g.estTimeHrs).toBe(naismithHours(5, 1000));
  });
});
