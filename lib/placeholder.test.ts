import { describe, it, expect } from 'vitest';
import { placeholderHue, placeholderBackground } from './placeholder';

describe('placeholderHue', () => {
  it('is deterministic — same key → same hue', () => {
    expect(placeholderHue('grca')).toBe(placeholderHue('grca'));
  });

  it('stays within 0–359', () => {
    for (const key of ['', 'a', 'grca', 'Yellowstone National Park', 'place-artist-point', '🏞️']) {
      const hue = placeholderHue(key);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it('varies across different keys (no single constant)', () => {
    const hues = new Set(['grca', 'yell', 'glac', 'zion', 'arch', 'acad', 'olym'].map(placeholderHue));
    expect(hues.size).toBeGreaterThan(1);
  });
});

describe('placeholderBackground', () => {
  it('produces a topo overlay + hue wash referencing the derived hue', () => {
    const bg = placeholderBackground('grca');
    expect(bg).toContain('repeating-radial-gradient');
    expect(bg).toContain('linear-gradient');
    expect(bg).toContain(`hsl(${placeholderHue('grca')} `);
  });

  it('is deterministic and falls back to a stable hue for an empty key', () => {
    expect(placeholderBackground('')).toBe(placeholderBackground(''));
    expect(placeholderBackground('')).toBe(placeholderBackground('park')); // empty → 'park'
  });
});
