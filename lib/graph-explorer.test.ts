import { describe, it, expect } from 'vitest';
import { zoomBandFor, computeCaptions } from './graph-explorer';

describe('zoomBandFor', () => {
  it('buckets the NVL scale into far/mid/near', () => {
    expect(zoomBandFor(0.2)).toBe('far');
    expect(zoomBandFor(0.49)).toBe('far');
    expect(zoomBandFor(0.5)).toBe('mid');
    expect(zoomBandFor(1.19)).toBe('mid');
    expect(zoomBandFor(1.2)).toBe('near');
    expect(zoomBandFor(3)).toBe('near');
  });
});

describe('computeCaptions', () => {
  const nodes = [
    { id: 'hub', degree: 8 },
    { id: 'mid', degree: 5 },
    { id: 'leaf', degree: 1 },
    { id: 'iso', degree: 0 },
  ];

  it('near zoom shows every caption', () => {
    const show = computeCaptions(nodes, { band: 'near' });
    expect(show).toEqual(new Set(['hub', 'mid', 'leaf', 'iso']));
  });

  it('mid zoom shows hubs (degree ≥ hubDegree) only', () => {
    const show = computeCaptions(nodes, { band: 'mid', hubDegree: 5 });
    expect(show).toEqual(new Set(['hub', 'mid']));
  });

  it('far zoom shows only the strongest hubs', () => {
    const show = computeCaptions(nodes, { band: 'far', hubDegree: 5 });
    expect([...show]).toEqual(['hub']); // degree ≥ 7
  });

  it('always includes hovered + selected, regardless of zoom', () => {
    const show = computeCaptions(nodes, {
      band: 'far',
      hoveredId: 'leaf',
      selectedIds: ['iso'],
      hubDegree: 5,
    });
    expect(show.has('leaf')).toBe(true);
    expect(show.has('iso')).toBe(true);
    expect(show.has('hub')).toBe(true);
  });
});
