/**
 * Topic-similarity backbone for the /graph constellation (de-hairball fix). The old seed linked any two
 * National Parks sharing ≥3 topics by RAW count, which — because generic topics (Animals/Wildlife/Geology)
 * sit on nearly every park — produced a near-complete graph (~92% density). This pure helper turns that into
 * a legible *similarity backbone*:
 *   1. weight each topic by IDF = log(N / df) so ubiquitous topics (df ≈ N) → ~0 and distinctive ones dominate;
 *   2. score each park pair by IDF-COSINE similarity (binary term-frequency), so an edge means "distinctively
 *      alike", not "topic-rich";
 *   3. keep each park's top-K most-similar neighbours (UNION kNN — keep if EITHER endpoint ranks it), with a
 *      connectivity FLOOR (every park with any topic-sharing peer keeps its single best edge, so no isolates)
 *      and a hard per-node degree CAP (kills the super-hubs union-kNN leaves unbounded), then a global edge cap.
 *
 * Pure + unit-tested (NO neo4j import); all similarity math is FLOAT; every step has deterministic tiebreaks
 * (sim desc, code asc) so the output is replay-stable. `graphSeed` feeds it the live HAS_TOPIC topic sets.
 */

export interface BackbonePark {
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  topics: string[];
}
export interface BackboneNode {
  code: string;
  name: string;
  lat: number | null;
  lng: number | null;
  degree: number;
}
export interface BackboneEdge {
  a: string;
  b: string;
  /** IDF-cosine similarity, 0..1 (FLOAT). */
  sim: number;
  /** Shared topics that actually contributed (idf > 0), ordered distinctive-first. */
  sharedTopics: string[];
}
export interface BackboneOpts {
  topK?: number;
  minSim?: number;
  maxDegree?: number;
  limit?: number;
}

export const DEFAULT_TOPK = 3;
export const DEFAULT_MIN_SIM = 0.05;
export const DEFAULT_MAX_DEGREE = 6;
export const DEFAULT_LIMIT = 400;

interface Pair {
  a: string;
  b: string;
  sim: number;
  sharedTopics: string[];
}
const keyOf = (p: { a: string; b: string }) => `${p.a}--${p.b}`;

export function buildTopicBackbone(
  parks: BackbonePark[],
  opts: BackboneOpts = {},
): { nodes: BackboneNode[]; edges: BackboneEdge[] } {
  const topK = opts.topK ?? DEFAULT_TOPK;
  const minSim = opts.minSim ?? DEFAULT_MIN_SIM;
  const maxDegree = opts.maxDegree ?? DEFAULT_MAX_DEGREE;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // Stable park order (drives all downstream tiebreaks).
  const sorted = [...parks].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const N = sorted.length;

  // DISTINCT topic set per park + document frequency per topic.
  const topicSets = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const p of sorted) {
    const set = new Set(p.topics ?? []);
    topicSets.set(p.code, set);
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  }
  // IDF: a topic on every park (df === N) → log(1) === 0 → contributes nothing (the de-hairball lever).
  const idf = (t: string): number => {
    const d = df.get(t) ?? 0;
    return d > 0 ? Math.log(N / d) : 0;
  };
  // L2 norm of each park's binary-tf IDF vector.
  const norm = new Map<string, number>();
  for (const p of sorted) {
    let s = 0;
    for (const t of topicSets.get(p.code)!) {
      const w = idf(t);
      s += w * w;
    }
    norm.set(p.code, Math.sqrt(s));
  }

  // Score every unordered pair with similarity > 0 (NOT yet filtered by minSim — the floor needs the
  // global best even when it's below the cutoff). Iterate the smaller topic set for the intersection.
  const pairs: Pair[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const ca = sorted[i].code;
      const cb = sorted[j].code;
      const na = norm.get(ca)!;
      const nb = norm.get(cb)!;
      if (na <= 0 || nb <= 0) continue;
      const sa = topicSets.get(ca)!;
      const sb = topicSets.get(cb)!;
      const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
      let dot = 0;
      const shared: string[] = [];
      for (const t of small) {
        if (!big.has(t)) continue;
        const w = idf(t);
        if (w > 0) {
          dot += w * w;
          shared.push(t);
        }
      }
      if (dot <= 0) continue;
      const sim = dot / (na * nb);
      shared.sort((x, y) => idf(y) - idf(x) || (x < y ? -1 : x > y ? 1 : 0)); // distinctive-first, stable
      pairs.push({ a: ca, b: cb, sim, sharedTopics: shared });
    }
  }

  // Per-node incident pairs, sorted (sim desc, peer code asc) for stable top-K + floor.
  const byNode = new Map<string, Pair[]>();
  for (const p of sorted) byNode.set(p.code, []);
  for (const pr of pairs) {
    byNode.get(pr.a)!.push(pr);
    byNode.get(pr.b)!.push(pr);
  }
  const peer = (pr: Pair, code: string) => (pr.a === code ? pr.b : pr.a);
  for (const [code, list] of byNode) {
    list.sort((x, y) => y.sim - x.sim || (peer(x, code) < peer(y, code) ? -1 : peer(x, code) > peer(y, code) ? 1 : 0));
  }

  const kept = new Set<string>();
  const floorEdges = new Set<string>();

  // (a) UNION top-K over CANDIDATES (sim ≥ minSim): keep an edge if either endpoint ranks it in its top-K.
  for (const [, list] of byNode) {
    let taken = 0;
    for (const pr of list) {
      if (taken >= topK) break;
      if (pr.sim < minSim) continue;
      kept.add(keyOf(pr));
      taken += 1;
    }
  }
  // (b) CONNECTIVITY FLOOR: any park with no kept edge but ≥1 topic-sharing peer keeps its single best
  //     edge — even below minSim — so a topically-thin park is never a lone dot.
  for (const [, list] of byNode) {
    if (list.length === 0) continue;
    if (list.some((pr) => kept.has(keyOf(pr)))) continue;
    const best = list[0];
    kept.add(keyOf(best));
    floorEdges.add(keyOf(best));
  }

  // (c) HARD DEGREE CAP: union-kNN leaves popular targets unbounded. Repeatedly take the most-over-cap node
  //     and drop its lowest-sim incident NON-FLOOR edge until no node exceeds maxDegree (or only floor edges
  //     remain — connectivity wins over a strict cap).
  const degree = (code: string) => byNode.get(code)!.filter((pr) => kept.has(keyOf(pr))).length;
  for (;;) {
    let worst: string | null = null;
    let worstDeg = maxDegree;
    for (const p of sorted) {
      const d = degree(p.code);
      if (d > worstDeg) {
        worst = p.code;
        worstDeg = d;
      }
    }
    if (!worst) break;
    const droppable = byNode
      .get(worst)!
      .filter((pr) => kept.has(keyOf(pr)) && !floorEdges.has(keyOf(pr)))
      .sort((x, y) => x.sim - y.sim || (keyOf(x) < keyOf(y) ? -1 : 1)); // lowest-sim first
    if (droppable.length === 0) break; // all incident edges are floor edges — leave it
    kept.delete(keyOf(droppable[0]));
  }

  // (d) GLOBAL edge cap (safety; rarely binds). Keep the strongest edges; floor edges first so connectivity
  //     survives even an aggressive limit.
  let edges: BackboneEdge[] = pairs
    .filter((pr) => kept.has(keyOf(pr)))
    .map((pr) => ({ a: pr.a, b: pr.b, sim: pr.sim, sharedTopics: pr.sharedTopics }));
  if (edges.length > limit) {
    edges.sort((x, y) => {
      const fx = floorEdges.has(keyOf(x)) ? 1 : 0;
      const fy = floorEdges.has(keyOf(y)) ? 1 : 0;
      return fy - fx || y.sim - x.sim || (keyOf(x) < keyOf(y) ? -1 : 1);
    });
    edges = edges.slice(0, limit);
  }

  // Final degree per node + emit EVERY park (degree 0 parks still render, so the header count stays correct).
  const finalDeg = new Map<string, number>();
  for (const e of edges) {
    finalDeg.set(e.a, (finalDeg.get(e.a) ?? 0) + 1);
    finalDeg.set(e.b, (finalDeg.get(e.b) ?? 0) + 1);
  }
  const nodes: BackboneNode[] = sorted.map((p) => ({
    code: p.code,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    degree: finalDeg.get(p.code) ?? 0,
  }));

  // Deterministic edge order for replay stability.
  edges.sort((x, y) => y.sim - x.sim || (keyOf(x) < keyOf(y) ? -1 : 1));
  return { nodes, edges };
}
