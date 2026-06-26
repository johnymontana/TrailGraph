import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, readGraph, writeGraph } from '../../lib/neo4j';
import { graphLens } from '../../lib/queries';
import { topicalPath, graphTripPath } from '../../lib/graph-query';
import { deriveSharedEdges } from '../../lib/sync/derive-shared';
import { deriveNear } from '../../lib/sync/derive-near';
import { deriveCoConsidered } from '../../lib/sync/derive-co-considered';

/**
 * Relationship lenses (lib/queries.ts#graphLens) + pathfinding/trip-route (lib/graph-query.ts) over the
 * MATERIALIZED park-park edges. The seed creates NONE of those edges, so beforeAll runs the derive steps
 * (deriveSharedEdges / deriveNear / deriveCoConsidered) against the seeded yell/glac/grca fixtures.
 *
 * Topic fixture: the seed gives yell {Volcanoes, Geology} and glac {Lakes}. We add three overlapping
 * HAS_TOPIC edges so yell & glac share exactly {Volcanoes, Geology, Lakes} (count 3) — enough for
 * deriveSharedEdges' default minTopics=3 to materialize one SHARES_TOPIC{count:3}. grca has no topics →
 * it stays disconnected (proves the "no path" / "no nearby route" branches).
 *
 * Real Neo4j, gated by RUN_INTEGRATION=1 (see db.ts). fileParallelism is off (vitest.config.ts), so the
 * global DELETEs in afterAll can't race another integration file; we still restore the seed's topic edges.
 */
describeIntegration('relationship lenses + pathfinding + trip route', () => {
  // Find a link between two parkCodes regardless of which is source/target (lenses canonicalize by
  // elementId, not parkCode, so the orientation isn't predictable from the call).
  const findPair = <T extends { source: string; target: string }>(links: T[], x: string, y: string): T | undefined =>
    links.find((l) => (l.source === x && l.target === y) || (l.source === y && l.target === x));

  beforeAll(async () => {
    await seedTestData();
    // Make yell + glac share three topics (Volcanoes, Geology, Lakes) so SHARES_TOPIC{count:3} materializes.
    await writeGraph(`
      MATCH (yell:Park {parkCode:'yell'}), (glac:Park {parkCode:'glac'}),
            (volc:Topic {id:'top-volc'}), (geol:Topic {id:'top-geology'}), (lakes:Topic {id:'top-lakes'})
      MERGE (yell)-[:HAS_TOPIC]->(lakes)
      MERGE (glac)-[:HAS_TOPIC]->(volc)
      MERGE (glac)-[:HAS_TOPIC]->(geol)
    `);
    await deriveSharedEdges(); // defaults: minTopics=3, minActivities=3 → one SHARES_TOPIC (yell↔glac)
    await deriveNear(400); // 400mi radius links yell↔glac (~324mi); grca (>590mi) stays isolated
    // deriveNear writes BOTH directions for a mutual pair. Delete the low→high-elementId direction so the
    // ONLY remaining yell↔glac edge runs high→low — the 'near' lens must still surface it (undirected match).
    await writeGraph(`MATCH (a:Park)-[r:NEAR]->(b:Park) WHERE elementId(a) < elementId(b) DELETE r`);
  });

  afterAll(async () => {
    // Drop everything we materialized + restore the seed's topic graph for the next integration file.
    await writeGraph(`MATCH (:Park)-[r:SHARES_TOPIC|SHARES_ACTIVITY|NEAR|CO_CONSIDERED]->(:Park) DELETE r`);
    await writeGraph(`MATCH (:Park {parkCode:'yell'})-[r:HAS_TOPIC]->(:Topic {id:'top-lakes'}) DELETE r`);
    await writeGraph(
      `MATCH (:Park {parkCode:'glac'})-[r:HAS_TOPIC]->(t:Topic) WHERE t.id IN ['top-volc','top-geology'] DELETE r`,
    );
    await closeDriver();
  });

  // ── shares_topic lens ─────────────────────────────────────────────────────
  it('graphLens("shares_topic") returns {nodes,links} with the shared count as link.value + a caption', async () => {
    const g = await graphLens('shares_topic'); // default minWeight = 3
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(Array.isArray(g.links)).toBe(true);
    const link = findPair(g.links, 'yell', 'glac');
    expect(link, 'expected a yell↔glac SHARES_TOPIC link').toBeTruthy();
    expect(link!.value).toBe(3); // {Volcanoes, Geology, Lakes}
    expect(link!.caption).toBe('3 shared topics');
    // both endpoints surface as degree-counted nodes carrying the park fullName
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.has('yell')).toBe(true);
    expect(byId.has('glac')).toBe(true);
    expect(byId.get('yell')!.name).toBe('Yellowstone National Park');
    expect(byId.get('yell')!.degree).toBeGreaterThanOrEqual(1);
  });

  it('graphLens("shares_topic") honors minWeight (a count-3 pair is excluded at minWeight 4)', async () => {
    const g = await graphLens('shares_topic', { minWeight: 4 });
    expect(findPair(g.links, 'yell', 'glac')).toBeFalsy();
  });

  // ── near lens (undirected NEAR + FLOAT maxMiles) ──────────────────────────
  it('graphLens("near") treats NEAR as undirected — a high→low-elementId-only edge still appears', async () => {
    // beforeAll deleted the low→high direction, so a DIRECTED low→high match finds nothing…
    const directed = await readGraph<{ n: number }>(
      `MATCH (a:Park)-[r:NEAR]->(b:Park) WHERE elementId(a) < elementId(b) RETURN count(r) AS n`,
    );
    expect(directed[0].n).toBe(0);
    // …but the lens' undirected `-[:NEAR]-` match still surfaces the pair.
    const g = await graphLens('near', { maxMiles: 500 });
    const link = findPair(g.links, 'yell', 'glac');
    expect(link, 'undirected NEAR match should still surface the yell↔glac pair').toBeTruthy();
    // value is the FLOAT drive-line miles (~324), never integer-coerced
    expect(typeof link!.value).toBe('number');
    expect(link!.value).toBeGreaterThan(150);
    expect(link!.value).toBeLessThan(500);
    expect(link!.caption).toMatch(/^\d+ mi$/); // caption rounds for display only
  });

  it('graphLens("near") applies maxMiles as a FLOAT bound (not toInteger-coerced)', async () => {
    const all = await graphLens('near', { maxMiles: 100000 });
    const edge = findPair(all.links, 'yell', 'glac');
    expect(edge).toBeTruthy();
    const miles = edge!.value; // exact stored FLOAT (1-decimal precision)
    // `r.miles <= $maxMiles`: at exactly `miles` the edge is included; 0.1 below it drops out. That 0.1
    // granularity only holds if maxMiles stays a FLOAT — a toInteger($maxMiles) would truncate and break it.
    const incl = await graphLens('near', { maxMiles: miles });
    expect(findPair(incl.links, 'yell', 'glac'), `<= ${miles} must include the edge`).toBeTruthy();
    const excl = await graphLens('near', { maxMiles: miles - 0.1 });
    expect(findPair(excl.links, 'yell', 'glac'), `< ${miles} must exclude the edge`).toBeFalsy();
  });

  // ── person_connected lens (live, no derive needed) ────────────────────────
  it('graphLens("person_connected") links parks sharing a Person, captioned "via <name>"', async () => {
    // Seed: Ferdinand Hayden is ASSOCIATED_WITH both yell and glac (value = 1) → needs minWeight 1.
    const g = await graphLens('person_connected', { minWeight: 1 });
    const link = findPair(g.links, 'yell', 'glac');
    expect(link, 'expected a yell↔glac person_connected link via Ferdinand Hayden').toBeTruthy();
    expect(link!.value).toBe(1);
    expect(link!.caption).toBe('via Ferdinand Hayden');
  });

  // ── co_considered lens (k-anonymity clamp) ────────────────────────────────
  it('graphLens("co_considered") clamps minUsers up to the k-anon floor of 5, even when asked for 2', async () => {
    // Materialize a sub-k (4 users) pair and a valid (6 users) pair directly. The lens MUST hide the
    // 4-user pair because minUsers is clamped to 5 server-side — passing {minUsers:2} can't lower it.
    await writeGraph(`
      MATCH (yell:Park {parkCode:'yell'}), (glac:Park {parkCode:'glac'}), (grca:Park {parkCode:'grca'})
      MERGE (yell)-[r1:CO_CONSIDERED]->(glac) SET r1.users = 4
      MERGE (yell)-[r2:CO_CONSIDERED]->(grca) SET r2.users = 6
    `);
    try {
      const g = await graphLens('co_considered', { minUsers: 2 });
      const valid = findPair(g.links, 'yell', 'grca');
      expect(valid, '6-user pair (>=5) should appear').toBeTruthy();
      expect(valid!.value).toBe(6);
      expect(valid!.caption).toBe('6 people consider both');
      expect(findPair(g.links, 'yell', 'glac'), '4-user pair (<5) must be clamped out').toBeFalsy();
    } finally {
      await writeGraph(`MATCH (:Park)-[r:CO_CONSIDERED]->(:Park) DELETE r`);
    }
  });

  it('deriveCoConsidered materializes a CO_CONSIDERED edge (>=5 users) that the lens surfaces', async () => {
    const userIds = Array.from({ length: 5 }, () => `cc-itest-${randomUUID()}`);
    await writeGraph(
      `UNWIND $userIds AS uid
       MATCH (yell:Park {parkCode:'yell'}), (glac:Park {parkCode:'glac'})
       MERGE (u:User {userId: uid})
       MERGE (u)-[:CONSIDERED]->(yell)
       MERGE (u)-[:CONSIDERED]->(glac)`,
      { userIds },
    );
    try {
      const { edges } = await deriveCoConsidered(); // clamps to 5; 5 distinct users → 1 edge
      expect(edges).toBeGreaterThanOrEqual(1);
      const g = await graphLens('co_considered', { minUsers: 5 });
      const link = findPair(g.links, 'yell', 'glac');
      expect(link, 'derived yell↔glac CO_CONSIDERED edge should surface').toBeTruthy();
      expect(link!.value).toBeGreaterThanOrEqual(5);
      expect(link!.caption).toMatch(/people consider both$/);
    } finally {
      await writeGraph(`UNWIND $userIds AS uid MATCH (u:User {userId: uid}) DETACH DELETE u`, { userIds });
      await writeGraph(`MATCH (:Park)-[r:CO_CONSIDERED]->(:Park) DELETE r`);
    }
  });

  // ── topicalPath ───────────────────────────────────────────────────────────
  it('topicalPath returns an ordered shortest path between two connected parks', async () => {
    const path = await topicalPath('yell', 'glac'); // connected by SHARES_TOPIC + NEAR
    expect(path.mode).toBe('topical');
    expect(path.totalMiles).toBeNull(); // topical paths are unweighted
    expect(path.nodes.length).toBeGreaterThanOrEqual(2);
    expect(path.nodes[0].id).toBe('yell'); // path starts at the source
    expect(path.nodes[path.nodes.length - 1].id).toBe('glac'); // and ends at the target
    expect(path.hops).toBe(path.links.length);
    expect(path.hops).toBeGreaterThanOrEqual(1);
    expect(path.orderedRelIds.length).toBe(path.links.length);
    // links chain consecutively along the node order
    for (let i = 0; i < path.links.length; i++) {
      expect(path.links[i].source).toBe(path.nodes[i].id);
      expect(path.links[i].target).toBe(path.nodes[i + 1].id);
      expect(path.orderedRelIds[i]).toBe(`${path.nodes[i].id}--${path.nodes[i + 1].id}`);
    }
    expect(path.narration).toContain('Yellowstone National Park');
    expect(path.narration).toContain('Glacier National Park');
  });

  it('topicalPath returns an empty path when no connection exists within 6 hops', async () => {
    const path = await topicalPath('yell', 'grca'); // grca has no SHARES_*/NEAR edges
    expect(path.nodes).toEqual([]);
    expect(path.links).toEqual([]);
    expect(path.hops).toBe(0);
    expect(path.orderedRelIds).toEqual([]);
    expect(path.narration).toBe('No connection found within 6 hops.');
  });

  // ── graphTripPath ─────────────────────────────────────────────────────────
  it('graphTripPath chains NEAR legs, dedupes shared endpoints, sums FLOAT miles, and falls back on gaps', async () => {
    // glac→yell is a real NEAR leg; yell→grca has no nearby route (synthetic). yell is the shared endpoint.
    const trip = await graphTripPath(['glac', 'yell', 'grca']);
    expect(trip.legs).toBe(2); // size(codes) - 1
    // dedup: yell appears in both legs but as a single node → 3 distinct parks, not 4
    expect(trip.nodes.map((n) => n.id).sort()).toEqual(['glac', 'grca', 'yell']);

    const realLeg = findPair(trip.links, 'glac', 'yell');
    expect(realLeg, 'glac↔yell NEAR leg should exist').toBeTruthy();
    expect(realLeg!.caption).toMatch(/^\d+ mi$/);

    const gapLeg = findPair(trip.links, 'yell', 'grca');
    expect(gapLeg, 'yell↔grca synthetic leg should exist').toBeTruthy();
    expect(gapLeg!.caption).toBe('no nearby route');

    // totalMiles = the single real leg's FLOAT distance (~324mi for yell↔glac), gaps contribute nothing
    expect(typeof trip.totalMiles).toBe('number');
    expect(trip.totalMiles!).toBeGreaterThan(150);
    expect(trip.totalMiles!).toBeLessThan(500);
    expect(trip.narration).toContain('Trip route:');
    expect(trip.narration).toContain('2 legs');
  });

  it('graphTripPath needs at least two parks', async () => {
    const trip = await graphTripPath(['yell']);
    expect(trip.legs).toBe(0);
    expect(trip.nodes).toEqual([]);
    expect(trip.links).toEqual([]);
    expect(trip.totalMiles).toBeNull();
    expect(trip.narration).toBe('Pick at least two parks to route a trip.');
  });
});
