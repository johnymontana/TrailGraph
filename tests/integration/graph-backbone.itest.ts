import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, readGraph, writeGraph } from '../../lib/neo4j';
import { graphSeed } from '../../lib/queries';
import { DEFAULT_MAX_DEGREE } from '../../lib/graph-backbone';

/**
 * The de-hairball topic-similarity backbone over REAL Neo4j: `graphSeed()` reads one row per National Park
 * (OPTIONAL MATCH HAS_TOPIC) and hands the live topic sets to the pure `buildTopicBackbone`. Gated by
 * RUN_INTEGRATION=1 (see db.ts). The base seed (yell/grca/glac) shares no topics, so we AUGMENT it with:
 *   • a UBIQUITOUS topic on EVERY National Park (df === N → idf 0 → must never label an edge), and
 *   • a DISTINCTIVE topic shared by exactly yell+grca (df 2 → forms a real backbone edge),
 * then assert the invariants that must hold at any graph size. All augmentation is torn down in afterAll.
 */
const UBIQ_ID = 'top-itest-backbone-ubiq';
const UBIQ_NAME = 'ITestUbiquitousTopic';
const SHARED_ID = 'top-itest-backbone-shared';
const SHARED_NAME = 'ITestDistinctiveShared';

describeIntegration('graphSeed topic-similarity backbone (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
    // A topic on EVERY National Park → document-frequency === N → IDF 0 → the de-hairball lever must
    // exclude it from every edge's shared-topic list.
    await writeGraph(
      `MERGE (u:Topic {id:$id}) SET u.name=$name
       WITH u
       MATCH (p:Park) WHERE p.designation CONTAINS 'National Park'
       MERGE (p)-[:HAS_TOPIC]->(u)`,
      { id: UBIQ_ID, name: UBIQ_NAME },
    );
    // A DISTINCTIVE topic shared by exactly two parks (yell+grca) → a genuine, surviving similarity edge.
    await writeGraph(
      `MERGE (s:Topic {id:$id}) SET s.name=$name
       WITH s
       MATCH (a:Park {parkCode:'yell'}), (b:Park {parkCode:'grca'})
       MERGE (a)-[:HAS_TOPIC]->(s)
       MERGE (b)-[:HAS_TOPIC]->(s)`,
      { id: SHARED_ID, name: SHARED_NAME },
    );
  });
  afterAll(async () => {
    // DETACH DELETE removes the topics AND the HAS_TOPIC edges we MERGEd, restoring the seed state.
    await writeGraph(`MATCH (t:Topic) WHERE t.id IN [$a,$b] DETACH DELETE t`, { a: UBIQ_ID, b: SHARED_ID });
    await closeDriver();
  });

  // The canonical set of National Park codes straight from the DB — what graphSeed MUST mirror exactly.
  async function npCodes(): Promise<string[]> {
    const rows = await readGraph<{ code: string }>(
      `MATCH (p:Park) WHERE p.designation CONTAINS 'National Park' RETURN p.parkCode AS code ORDER BY code`,
    );
    return rows.map((r) => r.code).sort();
  }

  it('emits a node for EVERY National Park (no vanishing park; header count stays correct)', async () => {
    const codes = await npCodes();
    const { nodes } = await graphSeed();
    expect(nodes.length).toBe(codes.length);
    expect(nodes.map((n) => n.id).sort()).toEqual(codes);
    // Each node is a well-formed Park node: bare-parkCode id === key === parkCode, with a numeric degree.
    for (const n of nodes) {
      expect(n.label).toBe('Park');
      expect(n.id).toBe(n.parkCode);
      expect(n.key).toBe(n.id);
      expect(typeof n.degree).toBe('number');
    }
    // Sanity: the three seeded NPs are present.
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['yell', 'grca', 'glac']));
  });

  it('is a SPARSE backbone: every node.degree <= the default cap, avg degree below the node count', async () => {
    const { nodes, links } = await graphSeed();
    // The hard, scale-independent guarantee: no super-hubs.
    for (const n of nodes) expect(n.degree!).toBeLessThanOrEqual(DEFAULT_MAX_DEGREE);
    // Node-level degree agrees with the actual incident-link count (degree is honestly computed).
    const incident = new Map<string, number>();
    for (const l of links) {
      incident.set(l.source, (incident.get(l.source) ?? 0) + 1);
      incident.set(l.target, (incident.get(l.target) ?? 0) + 1);
    }
    for (const n of nodes) expect(n.degree ?? 0).toBe(incident.get(n.id) ?? 0);
    // Sparse, not a hairball: average degree is comfortably below the node count.
    const avgDeg = (links.length * 2) / nodes.length;
    expect(avgDeg).toBeLessThan(nodes.length);
    expect(avgDeg).toBeLessThanOrEqual(DEFAULT_MAX_DEGREE);
  });

  it('excludes UBIQUITOUS topics (df === N) from every edge — that is the whole de-hairball point', async () => {
    const { links } = await graphSeed();
    // Data-driven: any topic present on ALL National Parks is ubiquitous (IDF 0) and must never label an edge.
    const dfRows = await readGraph<{ name: string }>(
      `MATCH (p:Park) WHERE p.designation CONTAINS 'National Park'
       WITH count(DISTINCT p) AS N
       MATCH (p2:Park)-[:HAS_TOPIC]->(t:Topic) WHERE p2.designation CONTAINS 'National Park'
       WITH N, t.name AS name, count(DISTINCT p2) AS df
       WHERE df = N AND name IS NOT NULL
       RETURN name`,
    );
    const ubiquitous = new Set(dfRows.map((r) => r.name));
    // Our injected topic IS ubiquitous (proves the assertion below isn't vacuous).
    expect(ubiquitous.has(UBIQ_NAME)).toBe(true);
    for (const l of links) {
      for (const t of l.topics ?? []) expect(ubiquitous.has(t)).toBe(false);
      expect(l.topics ?? []).not.toContain(UBIQ_NAME);
    }
  });

  it('every edge carries non-empty topics and link.value === link.topics.length', async () => {
    const { links } = await graphSeed();
    // The augmentation guarantees at least one surviving edge (yell+grca share a distinctive topic).
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const l of links) {
      expect(Array.isArray(l.topics)).toBe(true);
      expect(l.topics!.length).toBeGreaterThan(0);
      expect(l.value).toBe(l.topics!.length);
    }
    // The distinctive yell↔grca edge is present, captioned by the distinctive topic, not the ubiquitous one.
    const edge = links.find(
      (l) =>
        (l.source === 'yell' && l.target === 'grca') || (l.source === 'grca' && l.target === 'yell'),
    );
    expect(edge, 'expected a yell↔grca similarity edge via the distinctive shared topic').toBeTruthy();
    expect(edge!.topics).toContain(SHARED_NAME);
    expect(edge!.topics).not.toContain(UBIQ_NAME);
  });

  it('is deterministic: two graphSeed() calls return identical structure (stable tiebreaks)', async () => {
    const a = await graphSeed();
    const b = await graphSeed();
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });
});
