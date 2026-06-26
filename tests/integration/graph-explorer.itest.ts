import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { expandNode, egoNetwork, unifiedNodeSearch, GRAPH_NODE_KEYS } from '../../lib/queries';
import { contentHash } from '../../lib/embeddings';
import { EMBEDDING_DIM } from '../../lib/env';

/**
 * Graph EXPLORER surfaces (#2/#3): expand-on-click (`expandNode`), ego-network (`egoNetwork`), and the
 * unified search box (`unifiedNodeSearch`). Real Neo4j, gated by RUN_INTEGRATION=1 (see db.ts).
 *
 * Seed coverage that makes the allowlist test MEANINGFUL: the seeded `yell` Park genuinely has neighbours
 * whose labels are NOT in `GRAPH_NODE_KEYS` — :Season (OPEN_IN), :OperatingHours (HAS_HOURS), :EntranceFee
 * (CHARGES), :EntrancePass (OFFERS_PASS), :Article/:NewsRelease/:AudioFile (ABOUT), :Event (HELD_AT),
 * :ParkingLot/:PassportStamp (IN_PARK), :LessonPlan (ABOUT). All MUST be filtered out by `$allowed`.
 *
 * `unifiedNodeSearch` embeds the query ONCE up front via `embedQuery`. Integration CI has no
 * AI_GATEWAY_API_KEY, so we pre-seed the persistent :QueryEmbedding cache for each tested query → the
 * vector resolves WITHOUT a live gateway call. The seeded vector is EMBEDDING_DIM-long so the (empty)
 * park/place/person vector indexes accept it and return zero rows — the "vectors absent, degrade
 * gracefully" path the prompt calls for — while the Topic/Activity CONTAINS branch (pure Cypher) still hits.
 */

const ALLOWED = Object.keys(GRAPH_NODE_KEYS);

/** Replicate lib/embed-cache.ts#normalize so a pre-seeded :QueryEmbedding hash matches embedQuery's lookup. */
function cacheHash(query: string): string {
  return contentHash(query.trim().toLowerCase().replace(/\s+/g, ' '));
}

/** Seed the persistent query-embedding cache for `query` (no AI Gateway needed). Returns the hash. */
async function seedQueryEmbedding(query: string): Promise<string> {
  const hash = cacheHash(query);
  // Non-zero, valid 1536-dim vector so an empty cosine vector index accepts it without throwing.
  const vector = Array.from({ length: EMBEDDING_DIM }, (_, i) => (i % 7) * 0.01 + 0.001);
  await writeGraph(`MERGE (q:QueryEmbedding {hash:$hash}) SET q.vector=$vector, q.createdAt=timestamp()`, {
    hash,
    vector,
  });
  return hash;
}

describeIntegration('graph explorer (expand / ego / unified search)', () => {
  const cachedQueries = ['Volcano', 'Hiking'];
  const cachedHashes: string[] = [];

  beforeAll(async () => {
    await seedTestData();
    for (const q of cachedQueries) cachedHashes.push(await seedQueryEmbedding(q));
  });

  afterAll(async () => {
    await writeGraph(`UNWIND $hashes AS h MATCH (q:QueryEmbedding {hash:h}) DETACH DELETE q`, {
      hashes: cachedHashes,
    });
    await closeDriver();
  });

  // ── expandNode ────────────────────────────────────────────────────────────────────────────────────
  it('expandNode(Park) returns ONLY allowlisted one-hop neighbours (no Season/User/expansion labels)', async () => {
    const { nodes, links } = await expandNode('yell', 'Park');
    expect(nodes.length).toBeGreaterThan(0);
    expect(links.length).toBeGreaterThan(0);

    // Every neighbour label is in the closed GRAPH_NODE_KEYS allowlist.
    for (const n of nodes) expect(ALLOWED).toContain(n.label);

    const labels = new Set(nodes.map((n) => n.label));
    // yell genuinely HAS these non-allowlisted neighbours in the seed — they MUST be filtered out.
    for (const banned of [
      'Season',
      'User',
      'Amenity',
      'OperatingHours',
      'EntranceFee',
      'EntrancePass',
      'ParkingLot',
      'Event',
      'Article',
      'NewsRelease',
      'AudioFile',
      'PassportStamp',
      'LessonPlan',
    ]) {
      expect(labels.has(banned), `expected ${banned} to be excluded`).toBe(false);
    }
    // ...and these allowlisted neighbours ARE present.
    expect([...labels]).toEqual(
      expect.arrayContaining(['Activity', 'Topic', 'Campground', 'VisitorCenter', 'State', 'Person', 'Place', 'Tour', 'Alert']),
    );

    // Every link is incident to the BARE-parkCode centre id.
    for (const l of links) expect(l.source === 'yell' || l.target === 'yell').toBe(true);
  });

  it('expandNode(Park) shapes nodes + edge DIRECTION correctly (outgoing OFFERS/HAS_PLACE, incoming IN_PARK)', async () => {
    const { nodes, links } = await expandNode('yell', 'Park');

    // OUTGOING: (Park)-[:OFFERS]->(Activity) — centre is the bare parkCode, neighbour id is `${label}:${key}`.
    expect(nodes.find((n) => n.id === 'Activity:act-hike')).toMatchObject({
      id: 'Activity:act-hike',
      label: 'Activity',
      key: 'act-hike',
      name: 'Hiking',
    });
    expect(links).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'yell', target: 'Activity:act-hike', caption: 'OFFERS' })]),
    );
    // OUTGOING: (Park)-[:HAS_PLACE]->(Place)
    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'yell', target: 'Place:place-artist-point', caption: 'HAS_PLACE' }),
      ]),
    );

    // INCOMING: (Campground)-[:IN_PARK]->(Park) — source is the neighbour, target is the centre.
    expect(nodes.find((n) => n.id === 'Campground:cg-canyon')).toMatchObject({
      id: 'Campground:cg-canyon',
      label: 'Campground',
      key: 'cg-canyon',
      name: 'Canyon Campground',
    });
    expect(links).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'Campground:cg-canyon', target: 'yell', caption: 'IN_PARK' })]),
    );
  });

  it('expandNode(Topic) returns the parks (+ allowlisted nodes) carrying that topic, incoming HAS_TOPIC', async () => {
    const { nodes, links } = await expandNode('top-volc', 'Topic');
    for (const n of nodes) expect(ALLOWED).toContain(n.label);
    expect([...new Set(nodes.map((n) => n.label))]).not.toContain('Season');

    // The Park that HAS_TOPIC top-volc shows up as a BARE-parkCode node.
    const park = nodes.find((n) => n.label === 'Park' && n.key === 'yell');
    expect(park).toBeTruthy();
    expect(park!.id).toBe('yell');

    // Direction: (Park)-[:HAS_TOPIC]->(Topic) → source park, target topic (centre id `Topic:top-volc`).
    expect(links).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'yell', target: 'Topic:top-volc', caption: 'HAS_TOPIC' })]),
    );
  });

  // ── egoNetwork ────────────────────────────────────────────────────────────────────────────────────
  it('egoNetwork(Park) returns {narration w/ centre name, nodes incl. the centre, links}', async () => {
    const ego = await egoNetwork('yell', 'Park');

    expect(ego.narration).toContain('Yellowstone National Park');
    expect(ego.narration).toMatch(/connection/);

    // Centre is the first node: bare parkCode id + Park label + full name.
    expect(ego.nodes[0]).toMatchObject({ id: 'yell', label: 'Park', name: 'Yellowstone National Park' });
    expect(ego.nodes.map((n) => n.id)).toContain('yell');

    // No Season (or other non-allowlisted label) leaks through the ego view.
    for (const n of ego.nodes) expect(ALLOWED).toContain(n.label);

    expect(ego.links.length).toBeGreaterThan(0);
    for (const l of ego.links) expect(l.source === 'yell' || l.target === 'yell').toBe(true);

    // node count == centre + the distinct neighbours expandNode finds.
    const exp = await expandNode('yell', 'Park', { limit: 60 });
    expect(ego.nodes.length).toBe(1 + exp.nodes.length);
  });

  it('egoNetwork narrates "no connections" for an isolated node', async () => {
    await writeGraph(`MERGE (t:Topic {id:'itest-iso-topic'}) SET t.name='Isolated Explorer Topic'`);
    try {
      const ego = await egoNetwork('itest-iso-topic', 'Topic');
      expect(ego.narration).toBe('Isolated Explorer Topic has no connections in the graph.');
      expect(ego.nodes).toHaveLength(1);
      expect(ego.nodes[0]).toMatchObject({ id: 'Topic:itest-iso-topic', label: 'Topic', name: 'Isolated Explorer Topic' });
      expect(ego.links).toHaveLength(0);
    } finally {
      await writeGraph(`MATCH (t:Topic {id:'itest-iso-topic'}) DETACH DELETE t`);
    }
  });

  // ── unifiedNodeSearch ─────────────────────────────────────────────────────────────────────────────
  it('unifiedNodeSearch finds a Topic by name substring (CONTAINS path; vector indexes degrade to no hits)', async () => {
    const res = await unifiedNodeSearch('Volcano', 6);
    expect(res.find((h) => h.kind === 'topic')).toMatchObject({
      kind: 'topic',
      label: 'Topic',
      key: 'top-volc',
      name: 'Volcanoes',
    });
    // park/place/person vector indexes are empty in the ephemeral DB → no vector hits, but no throw.
    expect(res.every((h) => h.kind === 'topic' || h.kind === 'activity')).toBe(true);
  });

  it('unifiedNodeSearch finds an Activity by name substring', async () => {
    const res = await unifiedNodeSearch('Hiking', 6);
    expect(res.find((h) => h.kind === 'activity')).toMatchObject({
      kind: 'activity',
      label: 'Activity',
      key: 'act-hike',
      name: 'Hiking',
    });
  });

  it('unifiedNodeSearch returns [] for queries shorter than 2 chars (short-circuits before embedding)', async () => {
    expect(await unifiedNodeSearch('a')).toEqual([]);
    expect(await unifiedNodeSearch('  ')).toEqual([]);
  });
});
