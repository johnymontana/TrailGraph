import { describe, it, expect } from 'vitest';
import { neighborhoodToNvl, parkNodeNav, labelColor, HUB_DEGREE, trailToNvl, TRAIL_THEME_PREFIX } from './graph-nvl';

describe('labelColor (per-park graph node palette)', () => {
  it('maps known labels to distinct colors and unknowns to a neutral gray', () => {
    expect(labelColor('Park')).toBe('#1B5E3F');
    expect(labelColor('Activity')).toBe('#2E7D52');
    expect(labelColor('Topic')).toBe('#E8702A');
    expect(labelColor('Whatever')).toBe('#AB9B77');
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
    expect(color('grca')).toBe('#E8702A'); // highlighted (overrides plain)
    expect(color('yell')).toBe('#1B5E3F'); // hub
    expect(color('glac')).toBe('#459268'); // plain
  });

  it('synthesizes a stable rel id and captions edges with topics or a shared count', () => {
    const { rels } = neighborhoodToNvl(data);
    expect(rels[0]).toMatchObject({ id: 'yell--glac', from: 'yell', to: 'glac', caption: 'Night Sky, Geology' });
    expect(rels[1].caption).toBe('2 shared'); // no topics → fallback
  });
});

describe('trailToNvl (thematic trail → mini-graph)', () => {
  const parks = [
    { parkCode: 'yose', name: 'Yosemite National Park' },
    { parkCode: 'muwo', name: 'Muir Woods National Monument' },
  ];

  it('emits a center theme node plus one node per park', () => {
    const { nodes } = trailToNvl('John Muir', parks);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ id: `${TRAIL_THEME_PREFIX}John Muir`, caption: 'John Muir' });
    expect(nodes.map((n) => n.id)).toContain('yose');
  });

  it('spokes the theme node to each park with a stable rel id', () => {
    const { rels } = trailToNvl('John Muir', parks);
    expect(rels).toHaveLength(2);
    expect(rels[0]).toMatchObject({ from: `${TRAIL_THEME_PREFIX}John Muir`, to: 'yose' });
    expect(rels[1].id).toBe(`${TRAIL_THEME_PREFIX}John Muir--muwo`);
  });

  it('renders just the theme hub (no rels) for an empty trail', () => {
    const { nodes, rels } = trailToNvl('Lonely Topic', []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe(`${TRAIL_THEME_PREFIX}Lonely Topic`);
    expect(rels).toHaveLength(0);
  });

  it('only the theme node carries the non-navigable prefix (park ids are plain codes)', () => {
    const { nodes } = trailToNvl('John Muir', parks);
    const prefixed = nodes.filter((n) => n.id.startsWith(TRAIL_THEME_PREFIX));
    expect(prefixed).toHaveLength(1);
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
