import { describe, it, expect } from 'vitest';
import { brandColors } from './brandColors';
import { pine, sand, trail } from '../theme/colors';

/**
 * brandColors is the resolved-hex bridge that keeps the non-React map/graph surfaces (MapLibre paint,
 * NVL nodes) in sync with the Chakra theme. It must derive from the same raw scales (theme/colors) and
 * differ per color mode so dark surfaces stay legible.
 */
describe('brandColors', () => {
  it('derives light-mode colors from the brand scales', () => {
    const c = brandColors('light');
    expect(c.pine).toBe(pine[600]);
    expect(c.trail).toBe(trail[500]);
    expect(c.onColor).toBe('#FFFFFF');
    expect(c.surface).toBe(sand[50]);
  });

  it('uses lighter brand values in dark mode so markers stay legible on a dark basemap', () => {
    const c = brandColors('dark');
    expect(c.pine).toBe(pine[400]);
    expect(c.trail).toBe(trail[400]);
    // Light and dark must actually differ for the primary brand color.
    expect(brandColors('dark').pine).not.toBe(brandColors('light').pine);
  });

  it('defaults to light when the mode is undefined (SSR / pre-mount)', () => {
    expect(brandColors(undefined)).toEqual(brandColors('light'));
  });

  it('exposes a passport-stamp accent with light/dark parity (#9: stamp pins + dark-sky boundary glow)', () => {
    expect(brandColors('light').stamps).toBe('#E0A82E');
    expect(brandColors('dark').stamps).toBe('#FFD86B');
    expect(brandColors('light').stamps).not.toBe(brandColors('dark').stamps);
  });

  it('always returns the full color contract', () => {
    for (const mode of ['light', 'dark'] as const) {
      const c = brandColors(mode);
      for (const key of ['pine', 'trail', 'trailLight', 'danger', 'faded', 'stamps', 'onColor', 'surface'] as const) {
        expect(c[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
