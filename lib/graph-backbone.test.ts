import { describe, it, expect } from 'vitest';
import { buildTopicBackbone, type BackbonePark } from './graph-backbone';

// Helper: a park with the given code + topic list (name/coords don't matter for the math).
const P = (code: string, topics: string[]): BackbonePark => ({ code, name: code.toUpperCase(), lat: null, lng: null, topics });

describe('buildTopicBackbone (de-hairball IDF-cosine + top-K backbone)', () => {
  it('drops a pair that shares ONLY a ubiquitous topic (idf = 0 contributes nothing)', () => {
    // "Animals" is on all 4 parks → idf = log(4/4) = 0. a & b share ONLY Animals → sim 0 → no edge.
    const parks = [
      P('a', ['Animals', 'Volcanoes']),
      P('b', ['Animals', 'Glaciers']),
      P('c', ['Animals', 'Volcanoes']),
      P('d', ['Animals', 'Glaciers']),
    ];
    const { edges } = buildTopicBackbone(parks, { minSim: 0.01 });
    // a–b share only Animals (idf 0) → must NOT be an edge. a–c share Volcanoes (distinctive) → edge.
    expect(edges.find((e) => e.a === 'a' && e.b === 'b')).toBeUndefined();
    expect(edges.find((e) => (e.a === 'a' && e.b === 'c'))).toBeDefined();
    // No surviving edge ever lists the ubiquitous topic as a "shared" reason.
    for (const e of edges) expect(e.sharedTopics).not.toContain('Animals');
  });

  it('orders sharedTopics distinctive-first (idf descending)', () => {
    // N=4. "Common" on 4/4 (idf 0, excluded); "Rare" on a,b (df 2 → highest idf); "Mid" on a,b,c (df 3 → lower).
    const parks = [
      P('a', ['Common', 'Rare', 'Mid']),
      P('b', ['Common', 'Rare', 'Mid']),
      P('c', ['Common', 'Mid']),
      P('d', ['Common']),
    ];
    const { edges } = buildTopicBackbone(parks, { minSim: 0.001 });
    const ab = edges.find((e) => e.a === 'a' && e.b === 'b')!;
    expect(ab).toBeDefined();
    // Rare (df 2 → higher idf) before Mid (df 3 → lower idf); Common (df 4 → idf 0) excluded.
    expect(ab.sharedTopics).toEqual(['Rare', 'Mid']);
  });

  it('IDF-cosine similarity is symmetric and in [0,1]', () => {
    const parks = [P('a', ['X', 'Y', 'Z']), P('b', ['X', 'Y']), P('c', ['Z', 'W'])];
    const { edges } = buildTopicBackbone(parks, { minSim: 0 });
    for (const e of edges) {
      expect(e.sim).toBeGreaterThan(0);
      expect(e.sim).toBeLessThanOrEqual(1 + 1e-9);
    }
    // identical topic sets → cosine 1.
    const twins = buildTopicBackbone([P('a', ['X', 'Y']), P('b', ['X', 'Y']), P('c', ['Q', 'R'])], { minSim: 0 });
    expect(twins.edges.find((e) => e.a === 'a' && e.b === 'b')!.sim).toBeCloseTo(1, 6);
  });

  it('bounds total degree at maxDegree (no super-hubs from union-kNN)', () => {
    // A hub park sharing a distinctive topic with everyone; many leaves. Without a cap the hub would
    // collect every leaf's top-1 edge.
    const parks: BackbonePark[] = [P('hub', ['Geology', 'Lakes', 'Forests'])];
    for (let i = 0; i < 12; i++) parks.push(P(`leaf${i}`, ['Geology', `t${i}`, `u${i % 3}`]));
    const { nodes } = buildTopicBackbone(parks, { topK: 3, maxDegree: 6, minSim: 0 });
    for (const n of nodes) expect(n.degree).toBeLessThanOrEqual(6);
  });

  it('never isolates a park that has a distinctive peer even below the minSim cutoff (connectivity floor)', () => {
    // 'thin' shares ONE distinctive topic (Geysers, df 3) with a & b, but has 4 unique high-idf topics, so its
    // best cosine (~0.06) is far below the high minSim cutoff → top-K drops it, the floor rescues it.
    const parks = [
      P('a', ['Geysers', 'X1', 'X2']),
      P('b', ['Geysers', 'X1', 'X2']),
      P('c', ['Y1', 'Y2', 'Y3']),
      P('d', ['Y1', 'Y2', 'Y3']),
      P('thin', ['Geysers', 'Z1', 'Z2', 'Z3', 'Z4']),
    ];
    const { nodes, edges } = buildTopicBackbone(parks, { topK: 2, minSim: 0.9 });
    expect(nodes.find((n) => n.code === 'thin')!.degree).toBeGreaterThanOrEqual(1);
    // a & b are near-identical → kept by top-K (not the floor); thin's edge is the floored weak one.
    expect(edges.find((e) => (e.a === 'a' && e.b === 'b'))).toBeDefined();
  });

  it('emits a node for EVERY park, even one with no topic-sharing peer (no vanishing park)', () => {
    const parks = [P('a', ['X', 'Y']), P('b', ['X', 'Y']), P('lonely', ['ZZZ'])];
    const { nodes, edges } = buildTopicBackbone(parks, { minSim: 0 });
    expect(nodes.map((n) => n.code).sort()).toEqual(['a', 'b', 'lonely']);
    expect(nodes.find((n) => n.code === 'lonely')!.degree).toBe(0); // no shared topic → genuinely edgeless
    expect(edges.every((e) => e.a !== 'lonely' && e.b !== 'lonely')).toBe(true);
  });

  it('is deterministic across identical runs (stable tiebreaks)', () => {
    const parks = [
      P('a', ['X', 'Y', 'Z']),
      P('b', ['X', 'Y']),
      P('c', ['Y', 'Z']),
      P('d', ['Z', 'W']),
      P('e', ['X', 'W']),
    ];
    const r1 = buildTopicBackbone(parks, { topK: 2 });
    const r2 = buildTopicBackbone(parks, { topK: 2 });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });

  it('handles empty input gracefully', () => {
    expect(buildTopicBackbone([])).toEqual({ nodes: [], edges: [] });
  });

  it('decisively de-hairballs: a dense generic-topic set collapses to a sparse backbone', () => {
    // 20 parks all sharing 3 generic topics (would be a near-complete graph under raw count) + each a
    // distinctive pair-topic. The backbone should bound degree well below the complete-graph degree (19).
    const generic = ['Animals', 'Geology', 'Wildlife'];
    const parks: BackbonePark[] = [];
    for (let i = 0; i < 20; i++) parks.push(P(`p${i}`, [...generic, `pair${Math.floor(i / 2)}`, `solo${i}`]));
    const { nodes, edges } = buildTopicBackbone(parks, { topK: 3, maxDegree: 6 });
    const avgDeg = (edges.length * 2) / nodes.length;
    expect(avgDeg).toBeLessThan(6); // not a hairball (complete graph would be avg degree 19)
    for (const n of nodes) expect(n.degree).toBeLessThanOrEqual(6);
  });

  it('topK=0 falls back to the connectivity floor only (no top-K edges, still no isolates)', () => {
    // a–b share P, b–c share Q (both distinctive). With topK=0 the union-kNN step keeps NOTHING; every
    // park with a topic-sharing peer is rescued by the floor's single-best edge.
    const parks = [P('a', ['P', 'u1']), P('b', ['P', 'Q', 'u2']), P('c', ['Q', 'u3'])];
    const { nodes, edges } = buildTopicBackbone(parks, { topK: 0, minSim: 0 });
    for (const n of nodes) expect(n.degree).toBeGreaterThanOrEqual(1); // floor guarantees no lone dots
    expect(edges.find((e) => e.a === 'a' && e.b === 'b')).toBeDefined();
    expect(edges.find((e) => e.a === 'b' && e.b === 'c')).toBeDefined();
    expect(nodes.find((n) => n.code === 'b')!.degree).toBe(2);
  });

  it('topK=1 keeps a star via union kNN: every spoke that ranks the hub #1 stays attached', () => {
    // Star: hub shares ONE distinctive topic with each of x/y/z; no spoke–spoke overlap. Each spoke ranks
    // the hub as its single best neighbour, so the UNION rule keeps all three edges even at topK=1.
    const parks = [P('hub', ['A', 'B', 'C']), P('x', ['A', 'x1']), P('y', ['B', 'y1']), P('z', ['C', 'z1'])];
    const { nodes, edges } = buildTopicBackbone(parks, { topK: 1, minSim: 0 });
    const deg = (c: string) => nodes.find((n) => n.code === c)!.degree;
    expect(deg('hub')).toBe(3);
    for (const leaf of ['x', 'y', 'z']) expect(deg(leaf)).toBe(1);
    expect(edges.length).toBe(3);
  });

  it('maxDegree=1 enforces the hard cap (drops over-cap non-floor edges down to the cap)', () => {
    // Same star — topK=3 first attaches all three spokes to the hub (degree 3), then the cap=1 must drop
    // the two lowest-keyed non-floor edges so NO node exceeds the cap.
    const parks = [P('hub', ['A', 'B', 'C']), P('x', ['A', 'x1']), P('y', ['B', 'y1']), P('z', ['C', 'z1'])];
    const { nodes } = buildTopicBackbone(parks, { topK: 3, maxDegree: 1, minSim: 0 });
    for (const n of nodes) expect(n.degree).toBeLessThanOrEqual(1);
    expect(nodes.find((n) => n.code === 'hub')!.degree).toBe(1);
  });

  it('a minSim above EVERY pair similarity leaves only floor edges (relies on the floor, no isolates)', () => {
    // Two identical pairs (cosine = 1.0 each); no cross-cluster overlap. minSim 1.1 is above the max
    // possible similarity, so the candidate filter passes nothing — the floor alone keeps the graph whole.
    const parks = [P('a', ['X', 'Y']), P('b', ['X', 'Y']), P('c', ['Z', 'W']), P('d', ['Z', 'W'])];
    const { nodes, edges } = buildTopicBackbone(parks, { topK: 3, minSim: 1.1 });
    for (const n of nodes) expect(n.degree).toBeGreaterThanOrEqual(1);
    expect(edges.length).toBe(2); // exactly the two floored best edges (a–b, c–d)
    expect(edges.find((e) => e.a === 'a' && e.b === 'b')).toBeDefined();
    expect(edges.find((e) => e.a === 'c' && e.b === 'd')).toBeDefined();
  });

  it('breaks similarity ties deterministically: the degree cap drops the lowest-keyed equal-sim edge', () => {
    // All three hub edges have IDENTICAL similarity. topK=3 keeps all of them; the cap=2 must drop exactly
    // one — the tiebreak (sim asc, then key asc) drops `hub--x` first, leaving hub--y and hub--z.
    const parks = [P('hub', ['A', 'B', 'C']), P('x', ['A', 'x1']), P('y', ['B', 'y1']), P('z', ['C', 'z1'])];
    const { nodes, edges } = buildTopicBackbone(parks, { topK: 3, maxDegree: 2, minSim: 0 });
    expect(edges.find((e) => e.a === 'hub' && e.b === 'x')).toBeUndefined();
    expect(edges.find((e) => e.a === 'hub' && e.b === 'y')).toBeDefined();
    expect(edges.find((e) => e.a === 'hub' && e.b === 'z')).toBeDefined();
    expect(nodes.find((n) => n.code === 'hub')!.degree).toBe(2);
  });

  it('value-equivalent invariant: every emitted edge has a non-empty sharedTopics (sim>0 ⇒ ≥1 reason)', () => {
    // A pair only enters the backbone when its IDF-cosine dot > 0, which requires ≥1 distinctive shared
    // topic — so sharedTopics is never empty (graphSeed maps its length to link.value, which is thus ≥1).
    const generic = ['Animals', 'Geology', 'Wildlife'];
    const parks: BackbonePark[] = [];
    for (let i = 0; i < 10; i++) parks.push(P(`p${i}`, [...generic, `pair${Math.floor(i / 2)}`, `solo${i}`]));
    const { edges } = buildTopicBackbone(parks, { topK: 3, maxDegree: 6 });
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.sharedTopics.length).toBeGreaterThan(0);
      for (const t of e.sharedTopics) expect(generic).not.toContain(t); // ubiquitous topics never label an edge
    }
  });
});
