import { describe, it, expect } from 'vitest';
import { neighborhoodToNvl, parkNodeNav, labelColor, HUB_DEGREE, trailToNvl, TRAIL_THEME_PREFIX, contextToNvl, isContextParkId, nodeIdFor, seedToNvl, nodeTypeLegend, bridgesToRels, recsToGraph, provenanceSubgraphIds, type SeedNode, type SeedLink, type ContextBridge } from './graph-nvl';

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

describe('contextToNvl (/me context graph + two-graph overlay merge keys, ADR-047)', () => {
  const memory = {
    preferences: [
      { kind: 'activity' as const, name: 'Stargazing', category: 'activity', value: 'dark skies', feedback: null, weight: 2 },
      { kind: 'topic' as const, name: 'Geology', category: 'topic', value: 'rocks', feedback: null, weight: null },
    ],
    considered: [{ parkCode: 'grca', name: 'Grand Canyon', source: 'viewed' }],
    planned: [{ tripId: 't1', name: 'Desert loop' }],
    travel: { wheelchair: true, rvMaxLengthFt: 22, requiredAmenities: ['Restrooms'] },
    passes: [{ id: 'atb-annual', name: 'America the Beautiful' }],
    stamps: [{ id: 's1', label: 'Canyon stamp' }],
    availability: { start: '2026-02-10', end: '2026-02-20' },
    trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false },
    trailHistory: { saved: [], wishlisted: [], done: [] }, campPreferences: { rig: null, maxLengthFt: null, hookups: null, tentOk: false, ada: false, pets: false, quiet: false, budget: null }, campHistory: { saved: [] }, home: { label: null, latitude: null, longitude: null },
  };

  it('anchors a "You" node and links every bridge with its literal relationship caption', () => {
    const { nodes, rels } = contextToNvl(memory);
    expect(nodes.find((n) => n.id === 'ctx:You')).toBeTruthy();
    const captions = new Set(rels.map((r) => r.caption));
    for (const t of ['PREFERS', 'CONSIDERED', 'PLANNED', 'TRAVELS_WITH', 'REQUIRES', 'HOLDS', 'COLLECTED', 'AVAILABLE']) {
      expect(captions.has(t)).toBe(true);
    }
    // every edge originates at You
    expect(rels.every((r) => r.from === 'ctx:You')).toBe(true);
  });

  it('keys a CONSIDERED park by its BARE parkCode so it merges with the domain graph', () => {
    const { nodes } = contextToNvl(memory);
    const grca = nodes.find((n) => n.id === 'grca');
    expect(grca).toBeTruthy();
    expect(grca!.caption).toBe('Grand Canyon');
    expect(isContextParkId('grca')).toBe(true); // bare → navigable park id
  });

  it('prefixes non-park context nodes with ctx: so they never collide with a parkCode', () => {
    const { nodes } = contextToNvl(memory);
    expect(nodes.find((n) => n.id === 'ctx:Activity:Stargazing')).toBeTruthy();
    expect(nodes.find((n) => n.id === 'ctx:Topic:Geology')).toBeTruthy();
    expect(nodes.find((n) => n.id === 'ctx:Constraint:travel')).toBeTruthy();
    expect(isContextParkId('ctx:Activity:Stargazing')).toBe(false);
  });

  it('renders trail-preference and saved/wishlisted/did trail bridges (ADR-071)', () => {
    const withTrails = {
      ...memory,
      trailPreferences: { maxMiles: 6, maxGainFt: null, difficulty: 'moderate', avoidExposure: true, dogsRequired: false },
      trailHistory: {
        saved: [{ id: 'nps:grca:bright-angel', name: 'Bright Angel' }],
        wishlisted: [],
        done: [{ id: 'nps:zion:angels-landing', name: 'Angels Landing' }],
      },
    };
    const { nodes, rels } = contextToNvl(withTrails);
    expect(nodes.find((n) => n.id === 'ctx:TrailPrefs:trail')?.caption).toBe('moderate · ≤ 6mi · no exposure');
    expect(nodes.find((n) => n.id === 'ctx:Trail:nps:grca:bright-angel')?.caption).toBe('Bright Angel');
    const trailRels = rels.filter((r) => ['PREFERS_TRAIL', 'SAVED', 'DID'].includes(r.caption ?? ''));
    expect(trailRels.map((r) => r.caption).sort()).toEqual(['DID', 'PREFERS_TRAIL', 'SAVED']);
    expect(trailRels.every((r) => r.from === 'ctx:You')).toBe(true);
  });

  it('renders just the You node for empty memory (nothing to overlay)', () => {
    const empty = { preferences: [], considered: [], planned: [], travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] }, passes: [], stamps: [], availability: { start: null, end: null }, trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false }, trailHistory: { saved: [], wishlisted: [], done: [] }, campPreferences: { rig: null, maxLengthFt: null, hookups: null, tentOk: false, ada: false, pets: false, quiet: false, budget: null }, campHistory: { saved: [] }, home: { label: null, latitude: null, longitude: null }, };
    const { nodes, rels } = contextToNvl(empty);
    expect(nodes).toHaveLength(1);
    expect(rels).toHaveLength(0);
  });
});

describe('contextToNvl edge de-duplication (review finding)', () => {
  it('does not emit duplicate edges when memory contains duplicate prefs/amenities', () => {
    const mem = {
      preferences: [
        { kind: 'activity' as const, name: 'Stargazing', category: 'activity', value: 'a', feedback: null, weight: null },
        { kind: 'activity' as const, name: 'Stargazing', category: 'activity', value: 'b', feedback: null, weight: null },
      ],
      considered: [],
      planned: [],
      travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: ['Restrooms', 'Restrooms'] },
      passes: [],
      stamps: [],
      availability: { start: null, end: null },
      trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false },
      trailHistory: { saved: [], wishlisted: [], done: [] }, campPreferences: { rig: null, maxLengthFt: null, hookups: null, tentOk: false, ada: false, pets: false, quiet: false, budget: null }, campHistory: { saved: [] }, home: { label: null, latitude: null, longitude: null },
    };
    const { nodes, rels } = contextToNvl(mem);
    // one Stargazing node, one Restrooms node (deduped), and exactly one edge each.
    expect(nodes.filter((n) => n.id === 'ctx:Activity:Stargazing')).toHaveLength(1);
    expect(nodes.filter((n) => n.id === 'ctx:Amenity:Restrooms')).toHaveLength(1);
    const ids = rels.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate rel ids
    expect(rels.filter((r) => r.to === 'ctx:Activity:Stargazing')).toHaveLength(1);
  });
});

describe('neighborhoodToNvl caption fallback (#4 lenses)', () => {
  it('prefers topic names, then a per-lens caption, then the legacy "N shared"', () => {
    const data = {
      nodes: [
        { id: 'a', name: 'A', degree: 1 },
        { id: 'b', name: 'B', degree: 1 },
        { id: 'c', name: 'C', degree: 1 },
      ],
      links: [
        { source: 'a', target: 'b', value: 3, topics: ['Geology'] },
        { source: 'a', target: 'c', value: 0, topics: [], caption: '71 mi' }, // lens edge: [] topics, has caption
        { source: 'b', target: 'c', value: 2 },
      ],
    };
    const { rels } = neighborhoodToNvl(data);
    const cap = Object.fromEntries(rels.map((r) => [r.id, r.caption]));
    expect(cap['a--b']).toBe('Geology');
    expect(cap['a--c']).toBe('71 mi');
    expect(cap['b--c']).toBe('2 shared');
  });
});

describe('nodeIdFor (multi-entity id convention)', () => {
  it('keeps parks BARE (overlay merge) and prefixes every other label', () => {
    expect(nodeIdFor('Park', 'yell')).toBe('yell');
    expect(nodeIdFor('Topic', 'topic:geology')).toBe('Topic:topic:geology');
    expect(nodeIdFor('Person', 'person:muir')).toBe('Person:person:muir');
  });
});

describe('seedToNvl (multi-entity explorer → NVL)', () => {
  const nodes: SeedNode[] = [
    { id: 'yell', label: 'Park', name: 'Yellowstone', key: 'yell', degree: 8 }, // hub
    { id: 'zion', label: 'Park', name: 'Zion', key: 'zion', degree: 1 }, // plain
    { id: 'grca', label: 'Park', name: 'Grand Canyon', key: 'grca', degree: 6 }, // highlighted
    { id: 'Topic:topic:geology', label: 'Topic', name: 'Geology', key: 'topic:geology' },
  ];
  const links: SeedLink[] = [
    { source: 'yell', target: 'zion', value: 4, topics: ['Wildlife', 'Geology'] },
    { source: 'yell', target: 'Topic:topic:geology', caption: 'HAS_TOPIC' },
  ];

  it('colours parks by highlight > hub > plain and entities by label', () => {
    const { nodes: out } = seedToNvl({ nodes, links }, ['grca']);
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    // hub (deg≥5) vs plain differ; highlighted differs from the hub colour; entity colours by label.
    expect(byId['yell'].color).not.toBe(byId['zion'].color);
    expect(byId['grca'].color).not.toBe(byId['yell'].color);
    expect(byId['Topic:topic:geology'].color).toBe(labelColor('Topic'));
    // park sizing tracks degree (6 + min(8,deg)*2)
    expect(byId['yell'].size).toBe(6 + 8 * 2);
    expect(byId['zion'].size).toBe(6 + 1 * 2);
  });

  it('captions park-park edges with shared topics and entity edges with the rel type', () => {
    const { rels } = seedToNvl({ nodes, links });
    const byId = Object.fromEntries(rels.map((r) => [r.id, r]));
    expect(byId['yell--zion'].caption).toBe('Wildlife, Geology');
    expect(byId['yell--Topic:topic:geology'].caption).toBe('HAS_TOPIC');
  });
});

describe('nodeTypeLegend', () => {
  it('dedupes + sorts labels with their colours', () => {
    const legend = nodeTypeLegend(['Park', 'Topic', 'Park', 'Person']);
    expect(legend.map((l) => l.label)).toEqual(['Park', 'Person', 'Topic']);
    expect(legend.find((l) => l.label === 'Person')!.color).toBe(labelColor('Person'));
  });
});

describe('bridgesToRels (#8 — you-in-the-graph)', () => {
  it('builds rels whose from-id byte-matches contextToNvl node ids and to is the bare parkCode', () => {
    const mem = {
      preferences: [{ kind: 'activity' as const, name: 'Stargazing', category: 'activity', value: null, feedback: null, weight: null }],
      considered: [],
      planned: [{ tripId: 't1', name: 'Loop' }],
      travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] },
      passes: [],
      stamps: [{ id: 's1', label: 'Yellowstone' }],
      availability: { start: null, end: null },
      trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false },
      trailHistory: { saved: [], wishlisted: [], done: [] }, campPreferences: { rig: null, maxLengthFt: null, hookups: null, tentOk: false, ada: false, pets: false, quiet: false, budget: null }, campHistory: { saved: [] }, home: { label: null, latitude: null, longitude: null },
    };
    const ctx = contextToNvl(mem);
    const ctxIds = new Set(ctx.nodes.map((n) => n.id));

    const bridges: ContextBridge[] = [
      { fromKind: 'activity', fromKey: 'Stargazing', via: 'OFFERS', parkCode: 'yell' },
      { fromKind: 'trip', fromKey: 't1', via: 'INCLUDES', parkCode: 'grca' },
      { fromKind: 'stamp', fromKey: 's1', via: 'AT', parkCode: 'yell' },
    ];
    const rels = bridgesToRels(bridges);
    // Every bridge's `from` endpoint must exist as a context node (so the overlay edge isn't dangling).
    for (const r of rels) expect(ctxIds.has(r.from)).toBe(true);
    expect(rels.find((r) => r.caption === 'OFFERS')).toMatchObject({ from: 'ctx:Activity:Stargazing', to: 'yell' });
    expect(rels.find((r) => r.caption === 'INCLUDES')).toMatchObject({ from: 'ctx:Trip:t1', to: 'grca' });
    expect(rels.find((r) => r.caption === 'AT')).toMatchObject({ from: 'ctx:PassportStamp:s1', to: 'yell' });
  });

  it('dedupes identical bridges', () => {
    const dup: ContextBridge = { fromKind: 'topic', fromKey: 'Geology', via: 'HAS_TOPIC', parkCode: 'yell' };
    expect(bridgesToRels([dup, dup])).toHaveLength(1);
  });
});

describe('recsToGraph (#9 — recommend from here)', () => {
  it('builds a star subgraph: seed centre, one spoke per rec captioned by why', () => {
    const { narration, nodes, links } = recsToGraph({ parkCode: 'yell', name: 'Yellowstone' }, [
      { parkCode: 'grte', name: 'Grand Teton', lat: 43.7, lng: -110.7, matched: ['Hiking', 'Geology', 'Wildlife', 'Stars'] },
      { parkCode: 'glac', name: 'Glacier', matched: [] },
    ]);
    const seed = nodes.find((n) => n.id === 'yell')!;
    expect(seed).toMatchObject({ id: 'yell', label: 'Park', parkCode: 'yell', degree: 2 });
    expect(nodes.map((n) => n.id).sort()).toEqual(['glac', 'grte', 'yell']);
    // Caption = the first 3 matched dims; an empty `matched` falls back to readable text.
    expect(links.find((l) => l.target === 'grte')).toEqual({ source: 'yell', target: 'grte', caption: 'Hiking, Geology, Wildlife' });
    expect(links.find((l) => l.target === 'glac')?.caption).toBe('shares your interests');
    expect(narration).toContain('Yellowstone');
    expect(narration).toContain('Grand Teton');
  });

  it('narrates the empty case (just the seed, no spokes)', () => {
    const { nodes, links, narration } = recsToGraph({ parkCode: 'yell', name: 'Yellowstone' }, []);
    expect(nodes).toHaveLength(1);
    expect(links).toHaveLength(0);
    expect(narration).toContain('No fresh recommendations');
  });
});

describe('provenanceSubgraphIds (#9 — why this park is in your world)', () => {
  it('byte-matches contextToNvl node/rel ids and bridgesToRels bridge ids', () => {
    const mem = {
      preferences: [
        { kind: 'activity' as const, name: 'Stargazing', category: 'activity', value: null, feedback: null, weight: null },
        { kind: 'topic' as const, name: 'Geology', category: 'topic', value: null, feedback: null, weight: null },
      ],
      considered: [{ parkCode: 'yell', name: 'Yellowstone', source: null }],
      planned: [],
      travel: { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] },
      passes: [],
      stamps: [],
      availability: { start: null, end: null },
      trailPreferences: { maxMiles: null, maxGainFt: null, difficulty: null, avoidExposure: false, dogsRequired: false },
      trailHistory: { saved: [], wishlisted: [], done: [] }, campPreferences: { rig: null, maxLengthFt: null, hookups: null, tentOk: false, ada: false, pets: false, quiet: false, budget: null }, campHistory: { saved: [] }, home: { label: null, latitude: null, longitude: null },
    };
    const ctx = contextToNvl(mem);
    const ctxNodeIds = new Set(ctx.nodes.map((n) => n.id));
    const ctxRelIds = new Set(ctx.rels.map((r) => r.id));
    const bridgeIds = new Set(
      bridgesToRels([
        { fromKind: 'activity', fromKey: 'Stargazing', via: 'OFFERS', parkCode: 'yell' },
        { fromKind: 'topic', fromKey: 'Geology', via: 'HAS_TOPIC', parkCode: 'yell' },
      ]).map((r) => r.id),
    );

    const { nodeIds, relIds } = provenanceSubgraphIds('yell', [
      { name: 'Stargazing', kind: 'activity', via: 'OFFERS' },
      { name: 'Geology', kind: 'topic', via: 'HAS_TOPIC' },
    ]);

    // Every highlighted node exists in the context graph (no dangling highlight).
    for (const id of nodeIds) expect(ctxNodeIds.has(id)).toBe(true);
    // You→pref + You→considered rels byte-match contextToNvl.
    expect(relIds.has('ctx:You--CONSIDERED--yell')).toBe(true);
    expect(ctxRelIds.has('ctx:You--CONSIDERED--yell')).toBe(true);
    expect(relIds.has('ctx:You--PREFERS--ctx:Activity:Stargazing')).toBe(true);
    expect(ctxRelIds.has('ctx:You--PREFERS--ctx:Activity:Stargazing')).toBe(true);
    // pref→park rels byte-match bridgesToRels.
    expect(relIds.has('ctx:Activity:Stargazing--OFFERS--yell')).toBe(true);
    expect(bridgeIds.has('ctx:Activity:Stargazing--OFFERS--yell')).toBe(true);
    expect(relIds.has('ctx:Topic:Geology--HAS_TOPIC--yell')).toBe(true);
    expect(bridgeIds.has('ctx:Topic:Geology--HAS_TOPIC--yell')).toBe(true);
  });

  it('always includes the You anchor + the park, even with no preferences', () => {
    const { nodeIds, relIds } = provenanceSubgraphIds('grca', []);
    expect([...nodeIds].sort()).toEqual(['ctx:You', 'grca']);
    expect(relIds.has('ctx:You--CONSIDERED--grca')).toBe(true);
  });
});

describe('recsToGraph — seed name fallback + rec coords + singular narration (new cases)', () => {
  it('falls back to the parkCode when the seed has no name and singularizes a one-rec narration', () => {
    const { nodes, links, narration } = recsToGraph({ parkCode: 'grsa', name: null }, [
      { parkCode: 'blca', name: 'Black Canyon', lat: 38.5, lng: -107.7, matched: ['Geology'] },
    ]);
    const seed = nodes.find((n) => n.id === 'grsa')!;
    // null seed name → the parkCode stands in for the SeedNode name (caption is added later by seedToNvl).
    expect(seed).toMatchObject({ id: 'grsa', label: 'Park', name: 'grsa', degree: 1 });
    expect(narration).toContain('grsa');
    // One rec → singular "1 more park", never "1 more parks".
    expect(narration).toContain('1 more park');
    expect(narration).not.toContain('1 more parks');
    // The single spoke is captioned by its matched dim.
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ source: 'grsa', target: 'blca', caption: 'Geology' });
  });

  it('carries each rec node lat/lng (null when absent) and pluralizes a multi-rec narration', () => {
    const { nodes, narration } = recsToGraph({ parkCode: 'yell', name: 'Yellowstone' }, [
      { parkCode: 'grte', name: 'Grand Teton', lat: 43.7, lng: -110.7, matched: ['Hiking'] },
      { parkCode: 'glac', name: 'Glacier', matched: ['Geology'] }, // no coords supplied
    ]);
    expect(nodes.find((n) => n.id === 'grte')).toMatchObject({ lat: 43.7, lng: -110.7 });
    expect(nodes.find((n) => n.id === 'glac')).toMatchObject({ lat: null, lng: null });
    expect(narration).toContain('2 more parks'); // plural
  });
});

describe('provenanceSubgraphIds — repeated pref paths collapse (new case)', () => {
  it('deduplicates identical pref paths via Set semantics', () => {
    const path = { name: 'Geology', kind: 'topic' as const, via: 'HAS_TOPIC' as const };
    const { nodeIds, relIds } = provenanceSubgraphIds('yell', [path, path]);
    expect([...nodeIds].sort()).toEqual(['ctx:Topic:Geology', 'ctx:You', 'yell']);
    // Exactly three rels: You→considered, You→pref, pref→park — no duplicates from the repeated path.
    expect(relIds.has('ctx:You--CONSIDERED--yell')).toBe(true);
    expect(relIds.has('ctx:You--PREFERS--ctx:Topic:Geology')).toBe(true);
    expect(relIds.has('ctx:Topic:Geology--HAS_TOPIC--yell')).toBe(true);
    expect(relIds.size).toBe(3);
  });
});
