import { describe, it, expect } from 'vitest';
import { neighborhoodToNvl, parkNodeNav, labelColor, HUB_DEGREE } from './graph-nvl';

describe('labelColor (per-park graph node palette)', () => {
  it('maps known labels to distinct colors and unknowns to a neutral gray', () => {
    expect(labelColor('Park')).toBe('#1864ab');
    expect(labelColor('Activity')).toBe('#2f9e44');
    expect(labelColor('Topic')).toBe('#f08c00');
    expect(labelColor('Whatever')).toBe('#868e96');
  });
});

describe('neighborhoodToNvl (/graph → NVL)', () => {
  const data = {
    nodes: [
      { id: 'yell', name: 'Yellowstone National Park', degree: HUB_DEGREE + 2 }, // hub
      { id: 'glac', name: 'Glacier National Park', degree: 1 }, // plain
      { id: 'grca', name: 'Grand Canyon National Park', degree: 3 }, // plain, but highlighted below
    ],
    links: [
      { source: 'yell', target: 'glac', value: 3, topics: ['Night Sky', 'Geology'] },
      { source: 'glac', target: 'grca', value: 2 },
    ],
  };

  it('captions nodes with their name and scales size with degree', () => {
    const { nodes } = neighborhoodToNvl(data);
    const yell = nodes.find((n) => n.id === 'yell')!;
    const glac = nodes.find((n) => n.id === 'glac')!;
    expect(yell.caption).toBe('Yellowstone National Park');
    expect(yell.size!).toBeGreaterThan(glac.size!); // higher degree → bigger
  });

  it('colors highlight > hub > plain', () => {
    const { nodes } = neighborhoodToNvl(data, ['grca']);
    const color = (id: string) => nodes.find((n) => n.id === id)!.color;
    expect(color('grca')).toBe('#e8590c'); // highlighted (overrides plain)
    expect(color('yell')).toBe('#1864ab'); // hub
    expect(color('glac')).toBe('#4dabf7'); // plain
  });

  it('synthesizes a stable rel id and captions edges with topics or a shared count', () => {
    const { rels } = neighborhoodToNvl(data);
    expect(rels[0]).toMatchObject({ id: 'yell--glac', from: 'yell', to: 'glac', caption: 'Night Sky, Geology' });
    expect(rels[1].caption).toBe('2 shared'); // no topics → fallback
  });
});

describe('parkNodeNav (per-park graph click routing)', () => {
  it('routes by node kind', () => {
    expect(parkNodeNav({ kind: 'park', parkCode: 'grca' })).toBe('/parks/grca');
    expect(parkNodeNav({ kind: 'activity', name: 'Dark Sky Viewing' })).toBe('/explore?activity=Dark%20Sky%20Viewing');
    expect(parkNodeNav({ kind: 'topic', name: 'Geology' })).toBe('/explore?topic=Geology');
    expect(parkNodeNav({ kind: 'state', code: 'WY' })).toBe('/explore?stateCode=WY');
  });

  it('returns null for non-navigable nodes', () => {
    expect(parkNodeNav({ kind: 'none' })).toBeNull();
    expect(parkNodeNav(undefined)).toBeNull();
  });
});
