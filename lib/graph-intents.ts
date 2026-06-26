import { readGraph } from './neo4j';
import { embedQuery } from './embed-cache';
import { nodeIdFor, type SeedNode, type SeedLink } from './graph-nvl';
import { thematicTrail, similarParks, nearbyParks, searchParks } from './queries';
import { shortestPathBetween } from './graph-query';

/**
 * "Ask the graph" intent registry (#5a, hybrid). A CURATED set of parameterized graph queries: the LLM
 * (chat `ask_graph` tool) or the embedding classifier (on-page query bar) only PICKS an intent + fills
 * typed params — neither ever emits raw Cypher. Each intent returns a narrated answer + a subgraph
 * (`SeedNode`/`SeedLink`, rendered via `seedToNvl`). Cluster/centrality/bridge intents are added with #7.
 */

export interface IntentResult {
  narration: string;
  nodes: SeedNode[];
  links: SeedLink[];
}

interface GraphIntent {
  id: IntentId;
  label: string;
  description: string;
  examples: string[];
  /** Best-effort param extraction from a free-text query (on-page bar). Null = couldn't fill params. */
  extract(query: string): Record<string, unknown> | null;
  run(params: Record<string, unknown>): Promise<IntentResult>;
}

export type IntentId =
  | 'parks_by_person'
  | 'parks_by_topic'
  | 'similar_to'
  | 'parks_near'
  | 'parks_sharing_topics'
  | 'parks_near_with_topic'
  | 'how_connected'
  | 'shared_between'
  | 'parks_in_cluster'
  | 'central_parks'
  | 'bridge_parks';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
type ParkRow = { parkCode: string; name: string; lat: number | null; lng: number | null };
const parkNode = (p: ParkRow): SeedNode => ({ id: p.parkCode, label: 'Park', name: p.name, key: p.parkCode, lat: p.lat, lng: p.lng });
const entityNode = (label: string, key: string, name: string): SeedNode => ({ id: nodeIdFor(label, key), label, name, key });
const empty = (narration: string): IntentResult => ({ narration, nodes: [], links: [] });
const notFound = (q: string): IntentResult => empty(`Couldn't find a park matching "${q}".`);
const topNames = (parks: { name: string }[], n = 5): string =>
  parks.slice(0, n).map((p) => p.name).join(', ') + (parks.length > n ? `, and ${parks.length - n} more` : '');

async function resolvePark(q: string): Promise<ParkRow | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;
  const r = await searchParks({ q: trimmed });
  const hit = r.items[0];
  return hit ? { parkCode: hit.parkCode, name: hit.name, lat: hit.lat, lng: hit.lng } : null;
}

/** Split "X and Y" / "between X and Y" / "X vs Y" / "X to Y" into two entity phrases. */
function splitTwo(q: string): [string, string] | null {
  const m = q.match(/(?:between\s+)?(.+?)\s+(?:and|&|vs\.?|to)\s+(.+)/i);
  if (!m) return null;
  const a = m[1].trim().replace(/^(parks?|how (?:are|is)|connection)\s+/i, '').trim();
  const b = m[2].trim().replace(/\s+(connected|related|share[d]?)\??$/i, '').trim();
  return a && b ? [a, b] : null;
}
const milesIn = (q: string): number | undefined => {
  const m = q.match(/(\d+)\s*(?:mi|miles)/i);
  return m ? Number(m[1]) : undefined;
};

// ── intents ─────────────────────────────────────────────────────────────────────────────────────────
const INTENTS: GraphIntent[] = [
  {
    id: 'parks_by_person',
    label: 'Parks connected to a person',
    description: 'parks_by_person(person) — parks tied to a historical figure (e.g. John Muir, Ansel Adams).',
    examples: ['parks connected to John Muir', 'which parks is Ansel Adams associated with', 'show Theodore Roosevelt parks', 'parks linked to a historical figure'],
    extract: (q) => {
      const m = q.match(/(?:connected to|associated with|linked to|tied to|about|by)\s+(.+)/i);
      const person = (m?.[1] ?? '').trim();
      return person ? { person } : null;
    },
    async run(params) {
      const person = String(params.person ?? '').trim();
      if (!person) return empty('Tell me a person to look up.');
      const parks = await thematicTrail({ person }, 20);
      if (!parks.length) return empty(`No parks found connected to "${person}".`);
      const center = entityNode('Person', person, parks[0].via ?? person);
      return {
        narration: `${center.name} connects ${parks.length} park${parks.length === 1 ? '' : 's'}: ${topNames(parks)}.`,
        nodes: [center, ...parks.map(parkNode)],
        links: parks.map((p) => ({ source: center.id, target: p.parkCode, caption: 'ASSOCIATED_WITH' })),
      };
    },
  },
  {
    id: 'parks_by_topic',
    label: 'Parks about a topic',
    description: 'parks_by_topic(topic) — parks tagged with a topic (e.g. Volcanoes, Dark Skies).',
    examples: ['parks about volcanoes', 'which parks feature dark skies', 'show me wildlife parks', 'parks with the geology topic'],
    extract: (q) => {
      const m = q.match(/(?:about|featuring|with(?: the)?(?: topic)?|on)\s+(.+)/i);
      const topic = (m?.[1] ?? '').replace(/\s+topic$/i, '').trim();
      return topic ? { topic } : null;
    },
    async run(params) {
      const topic = String(params.topic ?? '').trim();
      if (!topic) return empty('Give me a topic.');
      const parks = await thematicTrail({ topic }, 30);
      if (!parks.length) return empty(`No parks found for the topic "${topic}".`);
      const center = entityNode('Topic', topic, topic);
      return {
        narration: `${parks.length} park${parks.length === 1 ? '' : 's'} share ${topic}: ${topNames(parks)}.`,
        nodes: [center, ...parks.map(parkNode)],
        links: parks.map((p) => ({ source: p.parkCode, target: center.id, caption: 'HAS_TOPIC' })),
      };
    },
  },
  {
    id: 'similar_to',
    label: 'Parks similar to a park',
    description: 'similar_to(park) — parks most similar (shared topics + activities) to a given park.',
    examples: ['parks like Yosemite', 'what is similar to Zion', 'show parks similar to Grand Canyon'],
    extract: (q) => {
      const m = q.match(/(?:like|similar to)\s+(.+)/i);
      const park = (m?.[1] ?? '').trim();
      return park ? { park } : null;
    },
    async run(params) {
      const parkQ = String(params.park ?? '').trim();
      const park = await resolvePark(parkQ);
      if (!park) return notFound(parkQ);
      const sims = await similarParks(park.parkCode, Number(params.limit) || 8);
      return {
        narration: sims.length ? `Parks most similar to ${park.name}: ${topNames(sims)}.` : `No similar parks found for ${park.name}.`,
        nodes: [parkNode(park), ...sims.map(parkNode)],
        links: sims.map((s) => ({ source: park.parkCode, target: s.parkCode, caption: `${s.shared} shared` })),
      };
    },
  },
  {
    id: 'parks_near',
    label: 'Parks near a park',
    description: 'parks_near(park, miles?) — parks within driving distance of a given park.',
    examples: ['parks near Zion', 'what parks are close to Yellowstone', 'parks within 100 miles of Arches'],
    extract: (q) => {
      const m = q.match(/(?:near|around|close to|within .* of)\s+(.+)/i);
      const park = (m?.[1] ?? '').replace(/\s+within\s+\d+.*$/i, '').trim();
      const miles = milesIn(q);
      return park ? { park, ...(miles ? { miles } : {}) } : null;
    },
    async run(params) {
      const parkQ = String(params.park ?? '').trim();
      const miles = Number(params.miles) || 200;
      const park = await resolvePark(parkQ);
      if (!park) return notFound(parkQ);
      const near = await nearbyParks(park.parkCode, miles, 12);
      return {
        narration: near.length ? `${near.length} parks within ${miles} mi of ${park.name}: ${topNames(near)}.` : `No parks within ${miles} mi of ${park.name}.`,
        nodes: [parkNode(park), ...near.map(parkNode)],
        links: near.map((n) => ({ source: park.parkCode, target: n.parkCode, caption: `${Math.round(n.miles)} mi` })),
      };
    },
  },
  {
    id: 'parks_sharing_topics',
    label: 'Parks sharing two topics',
    description: 'parks_sharing_topics(topic1, topic2) — parks tagged with BOTH topics.',
    examples: ['parks that share both volcanoes and dark skies', 'parks with geology and wildlife', 'which parks have both deserts and night sky'],
    extract: (q) => {
      const pair = splitTwo(q.replace(/^.*?(?:share|sharing|with|both|have)\s+/i, ''));
      return pair ? { topic1: pair[0], topic2: pair[1] } : null;
    },
    async run(params) {
      const t1 = String(params.topic1 ?? '').trim();
      const t2 = String(params.topic2 ?? '').trim();
      if (!t1 || !t2) return empty('Give me two topics.');
      const rows = await readGraph<ParkRow>(
        `MATCH (t1:Topic) WHERE toLower(t1.name) = toLower($t1)
         MATCH (t2:Topic) WHERE toLower(t2.name) = toLower($t2)
         MATCH (p:Park)-[:HAS_TOPIC]->(t1), (p)-[:HAS_TOPIC]->(t2)
         RETURN p.parkCode AS parkCode, p.fullName AS name, p.location.latitude AS lat, p.location.longitude AS lng
         ORDER BY name LIMIT toInteger($limit)`,
        { t1, t2, limit: 30 },
      );
      const c1 = entityNode('Topic', t1, t1);
      const c2 = entityNode('Topic', t2, t2);
      return {
        narration: rows.length ? `${rows.length} park${rows.length === 1 ? '' : 's'} share both ${t1} and ${t2}: ${topNames(rows)}.` : `No parks share both ${t1} and ${t2}.`,
        nodes: [c1, c2, ...rows.map(parkNode)],
        links: rows.flatMap((p) => [
          { source: p.parkCode, target: c1.id, caption: 'HAS_TOPIC' },
          { source: p.parkCode, target: c2.id, caption: 'HAS_TOPIC' },
        ]),
      };
    },
  },
  {
    id: 'parks_near_with_topic',
    label: 'Parks near a park sharing a topic',
    description: 'parks_near_with_topic(park, topic, miles?) — parks near a park that also share a topic.',
    examples: ['volcanoes near Yellowstone', 'dark sky parks near Zion within 200 miles', 'parks with wildlife close to Glacier'],
    extract: (q) => {
      const m = q.match(/(.+?)\s+(?:near|around|close to)\s+(.+)/i);
      if (!m) return null;
      const topic = m[1].replace(/^(parks?\s+(?:about|with)?\s*)/i, '').trim();
      const park = m[2].replace(/\s+within\s+\d+.*$/i, '').trim();
      const miles = milesIn(q);
      return topic && park ? { topic, park, ...(miles ? { miles } : {}) } : null;
    },
    async run(params) {
      const parkQ = String(params.park ?? '').trim();
      const topic = String(params.topic ?? '').trim();
      const miles = Number(params.miles) || 200;
      if (!topic) return empty('Give me a topic.');
      const anchor = await resolvePark(parkQ);
      if (!anchor) return notFound(parkQ);
      const rows = await readGraph<ParkRow & { miles: number }>(
        `MATCH (anchor:Park {parkCode: $park})
         MATCH (t:Topic) WHERE toLower(t.name) = toLower($topic)
         MATCH (q:Park)-[:HAS_TOPIC]->(t)
         WHERE q.parkCode <> $park AND q.location IS NOT NULL AND anchor.location IS NOT NULL
           AND point.distance(anchor.location, q.location) / 1609.344 < $miles
         WITH anchor, t, q, round(point.distance(anchor.location, q.location) / 1609.344 * 10) / 10.0 AS miles
         ORDER BY miles ASC LIMIT toInteger($limit)
         RETURN q.parkCode AS parkCode, q.fullName AS name, q.location.latitude AS lat, q.location.longitude AS lng, miles`,
        { park: anchor.parkCode, topic, miles, limit: 20 },
      );
      const center = parkNode(anchor);
      const tnode = entityNode('Topic', topic, topic);
      return {
        narration: rows.length ? `${rows.length} park${rows.length === 1 ? '' : 's'} within ${miles} mi of ${anchor.name} share ${topic}: ${topNames(rows)}.` : `No parks within ${miles} mi of ${anchor.name} share ${topic}.`,
        nodes: [center, tnode, ...rows.map(parkNode)],
        links: rows.flatMap((p) => [
          { source: center.id, target: p.parkCode, caption: `${Math.round(p.miles)} mi` },
          { source: p.parkCode, target: tnode.id, caption: 'HAS_TOPIC' },
        ]),
      };
    },
  },
  {
    id: 'how_connected',
    label: 'How two parks connect',
    description: 'how_connected(a, b) — the shortest path between two parks across shared topics / activities / proximity.',
    examples: ['how are Gettysburg and Yosemite connected', 'connection between Zion and Acadia', 'how do Manzanar and Yellowstone connect'],
    extract: (q) => {
      const pair = splitTwo(q);
      return pair ? { a: pair[0], b: pair[1] } : null;
    },
    async run(params) {
      const aQ = String(params.a ?? '').trim();
      const bQ = String(params.b ?? '').trim();
      const [a, b] = await Promise.all([resolvePark(aQ), resolvePark(bQ)]);
      if (!a) return notFound(aQ);
      if (!b) return notFound(bQ);
      if (a.parkCode === b.parkCode) return empty(`${a.name} is the same park.`);
      // Reuse the #6 pathfinding engine (built-in shortestPath over the materialized park-park edges).
      const path = await shortestPathBetween(a.parkCode, b.parkCode, 'topical');
      if (!path.nodes.length) return empty(`No connection found between ${a.name} and ${b.name} within 6 hops.`);
      return { narration: path.narration, nodes: path.nodes, links: path.links };
    },
  },
  {
    id: 'shared_between',
    label: 'What two parks share',
    description: 'shared_between(a, b) — the topics + activities both parks have in common.',
    examples: ['what do Zion and Bryce share', 'shared topics between Yellowstone and Glacier', 'what do Acadia and Shenandoah have in common'],
    extract: (q) => {
      const pair = splitTwo(q.replace(/^.*?(?:share[d]?|common|between)\s+/i, ''));
      return pair ? { a: pair[0], b: pair[1] } : null;
    },
    async run(params) {
      const aQ = String(params.a ?? '').trim();
      const bQ = String(params.b ?? '').trim();
      const [a, b] = await Promise.all([resolvePark(aQ), resolvePark(bQ)]);
      if (!a) return notFound(aQ);
      if (!b) return notFound(bQ);
      const rows = await readGraph<{ label: string; name: string; id: string | null }>(
        `MATCH (pa:Park {parkCode: $a}), (pb:Park {parkCode: $b})
         MATCH (pa)-[:HAS_TOPIC|OFFERS]->(x)<-[:HAS_TOPIC|OFFERS]-(pb)
         RETURN head(labels(x)) AS label, x.name AS name, x.id AS id
         LIMIT toInteger($limit)`,
        { a: a.parkCode, b: b.parkCode, limit: 30 },
      );
      const ca = parkNode(a);
      const cb = parkNode(b);
      const xnodes = rows.map((r) => entityNode(r.label, r.id ?? r.name, r.name));
      return {
        narration: rows.length ? `${a.name} and ${b.name} share ${rows.length}: ${rows.slice(0, 6).map((r) => r.name).join(', ')}.` : `${a.name} and ${b.name} share no topics or activities directly.`,
        nodes: [ca, cb, ...xnodes],
        links: rows.flatMap((r, i) => {
          const via = r.label === 'Activity' ? 'OFFERS' : 'HAS_TOPIC';
          return [
            { source: ca.id, target: xnodes[i].id, caption: via },
            { source: cb.id, target: xnodes[i].id, caption: via },
          ];
        }),
      };
    },
  },
  {
    id: 'parks_in_cluster',
    label: 'Parks in the same cluster',
    description: 'parks_in_cluster(park) — the emergent community (GDS) a park belongs to, and its members.',
    examples: ['what cluster is Yellowstone in', 'parks in the same community as Zion', "show Yosemite's cluster"],
    extract: (q) => {
      const m = q.match(/(?:cluster|community|group)\b.*?(?:as|is|of|for|like)?\s+([A-Za-z].+)/i) || q.match(/(.+?)['’]?s (?:cluster|community)/i);
      const park = (m?.[1] ?? '').replace(/\b(in|the|same)\b/gi, '').trim();
      return park ? { park } : null;
    },
    async run(params) {
      const parkQ = String(params.park ?? '').trim();
      const park = await resolvePark(parkQ);
      if (!park) return notFound(parkQ);
      const rows = await readGraph<ParkRow & { cid: number; topTopics: string[] }>(
        `MATCH (p:Park {parkCode: $park})-[:IN_COMMUNITY]->(c:Community)<-[:IN_COMMUNITY]-(m:Park)
         WHERE m.designation CONTAINS 'National Park'
         WITH c, m ORDER BY m.fullName LIMIT toInteger($limit)
         RETURN c.id AS cid, coalesce(c.topTopics, []) AS topTopics,
                m.parkCode AS parkCode, m.fullName AS name, m.location.latitude AS lat, m.location.longitude AS lng`,
        { park: park.parkCode, limit: 30 },
      );
      if (!rows.length) return empty(`No cluster found for ${park.name} (graph analytics may not be computed yet).`);
      const label = (rows[0].topTopics ?? []).slice(0, 3).join(' · ') || `Cluster ${rows[0].cid}`;
      const center = entityNode('Community', String(rows[0].cid), label);
      const members = rows.map((r) => parkNode(r));
      return {
        narration: `${park.name} is in a ${rows.length}-park cluster (${label}): ${topNames(rows)}.`,
        nodes: [center, ...members],
        links: members.map((m) => ({ source: m.id, target: center.id, caption: 'IN_COMMUNITY' })),
      };
    },
  },
  {
    id: 'central_parks',
    label: 'Most central parks',
    description: 'central_parks(limit?) — the most thematically central parks by PageRank (GDS).',
    examples: ['most central parks', 'which parks are the most connected', 'top hub parks'],
    extract: () => ({}),
    async run(params) {
      const rows = await readGraph<ParkRow & { score: number }>(
        `MATCH (p:Park) WHERE p.pagerank IS NOT NULL AND p.designation CONTAINS 'National Park'
         RETURN p.parkCode AS parkCode, p.fullName AS name, p.pagerank AS score,
                p.location.latitude AS lat, p.location.longitude AS lng
         ORDER BY score DESC LIMIT toInteger($limit)`,
        { limit: Number(params.limit) || 8 },
      );
      if (!rows.length) return empty('Centrality is not computed yet — run the graph analytics.');
      return {
        narration: `The most thematically central parks: ${topNames(rows)}.`,
        nodes: rows.map(parkNode),
        links: [],
      };
    },
  },
  {
    id: 'bridge_parks',
    label: 'Bridge parks',
    description: 'bridge_parks(limit?) — parks that bridge the most otherwise-separate clusters (betweenness/GDS).',
    examples: ['which parks bridge different themes', 'bridge parks', 'parks connecting separate clusters'],
    extract: () => ({}),
    async run(params) {
      const rows = await readGraph<ParkRow & { bridges: number }>(
        `MATCH (p:Park)-[:SHARES_TOPIC|SHARES_ACTIVITY|NEAR]-(q:Park)
         WHERE p.community IS NOT NULL AND q.community IS NOT NULL AND q.community <> p.community
           AND p.designation CONTAINS 'National Park'
         WITH p, count(DISTINCT q.community) AS bridges, coalesce(p.betweenness, 0.0) AS bc
         RETURN p.parkCode AS parkCode, p.fullName AS name, bridges,
                p.location.latitude AS lat, p.location.longitude AS lng
         ORDER BY bridges DESC, bc DESC LIMIT toInteger($limit)`,
        { limit: Number(params.limit) || 8 },
      );
      if (!rows.length) return empty('Cluster bridges are not computed yet — run the graph analytics.');
      return {
        narration: `Parks that bridge the most clusters: ${topNames(rows)}.`,
        nodes: rows.map(parkNode),
        links: [],
      };
    },
  },
];

const INTENT_MAP = Object.fromEntries(INTENTS.map((i) => [i.id, i])) as Record<IntentId, GraphIntent>;
export const INTENT_IDS = INTENTS.map((i) => i.id) as [IntentId, ...IntentId[]];
/** A compact guide for the `ask_graph` tool prompt — one line per intent. */
export const INTENT_GUIDE = INTENTS.map((i) => `- ${i.description}`).join('\n');

/** Run a curated intent with typed params (chat `ask_graph` tool path). */
export async function runIntent(id: string, params: Record<string, unknown>): Promise<IntentResult> {
  const intent = INTENT_MAP[id as IntentId];
  if (!intent) return empty(`Unknown query type "${id}".`);
  return intent.run(params ?? {});
}

// ── embedding classifier (on-page bar; no LLM) ────────────────────────────────────────────────────────
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

let exampleCache: { id: IntentId; vec: number[] }[] | null = null;
async function exampleEmbeddings() {
  if (exampleCache) return exampleCache;
  const out: { id: IntentId; vec: number[] }[] = [];
  for (const intent of INTENTS) for (const ex of intent.examples) out.push({ id: intent.id, vec: await embedQuery(ex) });
  exampleCache = out;
  return out;
}

/** Rank intents by embedding similarity to the query (best first). */
export async function classifyIntent(query: string): Promise<{ id: IntentId; score: number }[]> {
  const qv = await embedQuery(query);
  const ex = await exampleEmbeddings();
  const best = new Map<IntentId, number>();
  for (const e of ex) {
    const s = cosine(qv, e.vec);
    if (s > (best.get(e.id) ?? -1)) best.set(e.id, s);
  }
  return [...best.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export interface GraphQueryAnswer extends IntentResult {
  intent?: IntentId;
  candidates?: { intent: IntentId; label: string }[];
}

const CLASSIFY_THRESHOLD = 0.3;
function chips(ranked: { id: IntentId }[], narration: string): GraphQueryAnswer {
  return { narration, nodes: [], links: [], candidates: ranked.slice(0, 3).map((r) => ({ intent: r.id, label: INTENT_MAP[r.id].label })) };
}

/** On-page bar: classify the NL query → fill params best-effort → run, or return intent chips. */
export async function answerGraphQuery(query: string): Promise<GraphQueryAnswer> {
  const ranked = await classifyIntent(query);
  const top = ranked[0];
  if (!top || top.score < CLASSIFY_THRESHOLD) return chips(ranked, "I'm not sure what you're asking — try one of these, or ask the ranger:");
  const intent = INTENT_MAP[top.id];
  const params = intent.extract(query);
  if (!params) return chips(ranked, `This looks like "${intent.label}" — ask the ranger for the details, or try:`);
  const result = await intent.run(params);
  return { ...result, intent: top.id };
}
