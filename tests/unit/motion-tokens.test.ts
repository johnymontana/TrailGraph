import { describe, it, expect } from 'vitest';
import { durations, easings, springs, stagger, draw } from '../../theme/motion';

/**
 * Guards the motion-token contract (ADR-044) so downstream `motion` usage can't silently drift — every
 * spring preset and named duration the components reference must exist with the expected shape.
 */
describe('motion tokens', () => {
  it('exposes the named durations as seconds', () => {
    expect(durations.fast).toBeGreaterThan(0);
    expect(durations.draw).toBeGreaterThan(durations.base);
    expect(durations.instant).toBe(0);
  });

  it('exposes spring presets used by the signature motions', () => {
    for (const name of ['gentle', 'snappy', 'bouncy', 'morph'] as const) {
      expect(springs[name].type).toBe('spring');
      expect(springs[name].stiffness).toBeGreaterThan(0);
      expect(springs[name].damping).toBeGreaterThan(0);
    }
  });

  it('exposes stagger intervals, cubic-bezier easings, and a path-draw tween', () => {
    expect(stagger.base).toBeGreaterThan(0);
    expect(easings.standard).toHaveLength(4);
    expect(easings.emphasized).toHaveLength(4);
    expect(draw.duration).toBe(durations.draw);
  });
});
