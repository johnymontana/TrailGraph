import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration, dbAvailable } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, readGraph, writeGraph } from '../../lib/neo4j';
import {
  gdsAvailable,
  getInsights,
  dropProjection,
  ensureNearProjection,
  THEME_GRAPH,
  NEAR_GRAPH,
} from '../../lib/graph-analytics';
import { deriveSharedEdges } from '../../lib/sync/derive-shared';
import { deriveCommunities } from '../../lib/sync/derive-communities';
import { deriveCentrality } from '../../lib/sync/derive-centrality';
import { deriveCoConsidered } from '../../lib/sync/derive-co-considered';

/**
 * GDS analytics (#7) + co-considered (#4) — the post-sync derive steps and the `getInsights` read side.
 * Real Neo4j, gated by RUN_INTEGRATION=1 (see db.ts). Every GDS assertion is *additionally* gated on the
 * plugin actually being installed (`const gds = await gdsAvailable()` + `it.skipIf(!gds)`), so the file
 * runs (and the non-GDS read/co-considered tests pass) on a vanilla Neo4j without GDS.
 *
 * The seed gives three National-Park nodes (yell/grca/glac) that share `Hiking`/`Astronomy` activities but
 * no park↔park *topic* overlap, so we `deriveSharedEdges(1, 1)` in beforeAll to materialize a connected
 * SHARES_ACTIVITY triangle — the relationship substrate the THEME_GRAPH projection needs to find a
 * community / non-zero centrality.
 */

// Probe GDS once at collection time (only when a DB is actually reachable — gdsAvailable() opens a
// connection). gdsAvailable swallows its own errors, so this never throws.
const gds = dbAvailable ? await gdsAvailable() : false;

const SEED_CODES = ['yell', 'grca', 'glac'];

/** Does a named GDS in-memory projection currently exist? (Used to assert the `finally` drop.) */
async function graphExists(name: string): Promise<boolean> {
  const r = await readGraph<{ exists: boolean }>(
    'CALL gds.graph.exists($name) YIELD exists RETURN exists',
    { name },
  );
  return r[0]?.exists === true;
}

/** Count materialized community artifacts (for the idempotency assertion). */
async function communityState(): Promise<{ communities: number; edges: number }> {
  const r = await readGraph<{ communities: number; edges: number }>(
    `MATCH (c:Community) WITH count(DISTINCT c) AS communities
     OPTIONAL MATCH (:Park)-[r:IN_COMMUNITY]->(:Community)
     RETURN communities, count(r) AS edges`,
  );
  return { communities: r[0]?.communities ?? 0, edges: r[0]?.edges ?? 0 };
}

/** Read the (undirected) CO_CONSIDERED user-count between two parks, or null if no edge. */
async function coConsideredUsers(a: string, b: string): Promise<number | null> {
  const r = await readGraph<{ users: number }>(
    `MATCH (:Park {parkCode:$a})-[r:CO_CONSIDERED]-(:Park {parkCode:$b}) RETURN r.users AS users`,
    { a, b },
  );
  return r[0]?.users ?? null;
}

describeIntegration('graph analytics (GDS) + co-considered + insights', () => {
  beforeAll(async () => {
    await seedTestData();
    // Lower the thresholds so the seed's shared activities (Hiking/Astronomy) produce a connected
    // SHARES_ACTIVITY triangle across yell/grca/glac for the theme projection to operate on.
    await deriveSharedEdges(1, 1);
  });

  afterAll(async () => {
    // Leave the DB clean for sibling integration files (analytics props are derived, never seeded).
    try {
      await dropProjection(THEME_GRAPH).catch(() => {});
      await dropProjection(NEAR_GRAPH).catch(() => {});
      await writeGraph(`MATCH ()-[r:IN_COMMUNITY]->() DELETE r`);
      await writeGraph(`MATCH (c:Community) DETACH DELETE c`);
      await writeGraph(`MATCH (:Park)-[r:SHARES_TOPIC|SHARES_ACTIVITY|NEAR|CO_CONSIDERED]->(:Park) DELETE r`);
      await writeGraph(`MATCH (p:Park) REMOVE p.community, p.pagerank, p.betweenness`);
      await writeGraph(`MATCH (u:User) WHERE u.userId STARTS WITH 'zzco-' DETACH DELETE u`);
      await writeGraph(
        `MATCH (p:Park) WHERE p.parkCode IN ['zzcoa','zzcob','zzbra','zzbrb'] DETACH DELETE p`,
      );
    } finally {
      await closeDriver();
    }
  });

  // ── deriveCommunities (GDS) ─────────────────────────────────────────────────
  it.skipIf(!gds)(
    'deriveCommunities writes Park.community + :Community/IN_COMMUNITY and drops its projection',
    async () => {
      const res = await deriveCommunities();
      expect(res.skipped).toBeUndefined();
      expect(res.communities).toBeGreaterThanOrEqual(1);
      expect(res.named).toBeGreaterThanOrEqual(1);

      // Park.community materialized as an integer on each seed park.
      const parks = await readGraph<{ parkCode: string; community: number | null }>(
        `MATCH (p:Park) WHERE p.parkCode IN $codes
         RETURN p.parkCode AS parkCode, p.community AS community`,
        { codes: SEED_CODES },
      );
      expect(parks).toHaveLength(3);
      for (const p of parks) {
        expect(p.community).not.toBeNull();
        expect(Number.isInteger(p.community)).toBe(true);
      }

      // :Community nodes + IN_COMMUNITY edges exist (≥1 community, ≥3 memberships for the triangle).
      const state = await communityState();
      expect(state.communities).toBeGreaterThanOrEqual(1);
      expect(state.edges).toBeGreaterThanOrEqual(3);

      // The named theme projection was released in the `finally`.
      expect(await graphExists(THEME_GRAPH)).toBe(false);
    },
  );

  it.skipIf(!gds)('deriveCommunities is idempotent — re-running does not accumulate artifacts', async () => {
    await deriveCommunities();
    const before = await communityState();
    await deriveCommunities();
    const after = await communityState();
    expect(after.communities).toBe(before.communities);
    expect(after.edges).toBe(before.edges);
    expect(await graphExists(THEME_GRAPH)).toBe(false);
  });

  // ── deriveCentrality (GDS) ──────────────────────────────────────────────────
  it.skipIf(!gds)(
    'deriveCentrality writes FLOAT Park.pagerank/betweenness and drops its projection',
    async () => {
      const res = await deriveCentrality();
      expect(res.skipped).toBeUndefined();
      expect(res.pagerank).toBeGreaterThanOrEqual(3); // ≥3 seed parks written
      expect(res.betweenness).toBeGreaterThanOrEqual(3);

      const parks = await readGraph<{ parkCode: string; pagerank: number | null; betweenness: number | null }>(
        `MATCH (p:Park) WHERE p.parkCode IN $codes
         RETURN p.parkCode AS parkCode, p.pagerank AS pagerank, p.betweenness AS betweenness`,
        { codes: SEED_CODES },
      );
      expect(parks).toHaveLength(3);
      for (const p of parks) {
        expect(typeof p.pagerank).toBe('number');
        expect(p.pagerank!).toBeGreaterThan(0); // pageRank is strictly positive
        // betweenness is a FLOAT score (0.0 for the symmetric triangle, but still a number, never null).
        expect(typeof p.betweenness).toBe('number');
        expect(Number.isFinite(p.betweenness!)).toBe(true);
      }

      expect(await graphExists(THEME_GRAPH)).toBe(false);
    },
  );

  it.skipIf(!gds)('ensureNearProjection (re)creates parks-near and reports a boolean; droppable', async () => {
    await dropProjection(NEAR_GRAPH).catch(() => {}); // start from a clean slate
    // No NEAR edges yet → a GDS native projection would throw; ensureNearProjection must guard and return false
    // (so drivingPath falls back to the topical path) rather than erroring or leaving a phantom projection.
    await writeGraph(`MATCH (:Park)-[r:NEAR]->(:Park) DELETE r`);
    expect(await ensureNearProjection()).toBe(false);
    expect(await graphExists(NEAR_GRAPH)).toBe(false);
    // With at least one NEAR edge, it projects and reports true.
    await writeGraph(
      `MATCH (a:Park {parkCode:'yell'}), (b:Park {parkCode:'grca'}) MERGE (a)-[r:NEAR]->(b) SET r.miles = 100.0`,
    );
    const ok = await ensureNearProjection();
    expect(ok).toBe(true);
    expect(await graphExists(NEAR_GRAPH)).toBe(true);
    // Calling again is a no-op (projection already exists) and still returns true.
    expect(await ensureNearProjection()).toBe(true);
    await dropProjection(NEAR_GRAPH);
    expect(await graphExists(NEAR_GRAPH)).toBe(false);
    await writeGraph(`MATCH (:Park)-[r:NEAR]->(:Park) DELETE r`); // clean up the fixture edge
  });

  // ── getInsights read side (GDS) ─────────────────────────────────────────────
  it.skipIf(!gds)('getInsights returns populated communities + central from materialized analytics', async () => {
    await deriveCommunities();
    await deriveCentrality();

    const ins = await getInsights(20);
    expect(Array.isArray(ins.communities)).toBe(true);
    expect(Array.isArray(ins.central)).toBe(true);
    expect(Array.isArray(ins.bridges)).toBe(true);
    expect(ins.communities.length).toBeGreaterThanOrEqual(1);

    const card = ins.communities.find((c) => c.parkCodes.includes('yell'));
    expect(card, 'a community card should include the yell NP member').toBeTruthy();
    expect(typeof card!.label).toBe('string');
    expect(card!.label.length).toBeGreaterThan(0);
    expect(typeof card!.id).toBe('number');
    // card.size counts ALL parks in the cluster; parkCodes are the NP-only members (size ≥ members).
    expect(card!.size).toBeGreaterThanOrEqual(card!.parkCodes.length);

    const yell = ins.central.find((p) => p.parkCode === 'yell');
    expect(yell, 'central should rank the seed NP parks').toBeTruthy();
    expect(typeof yell!.score).toBe('number');
    expect(yell!.score).toBeGreaterThan(0);
    expect(ins.central.map((p) => p.parkCode)).toEqual(expect.arrayContaining(SEED_CODES));
  });

  // ── getInsights bridges (read-side, GDS-free deterministic fixture) ──────────
  // The seed triangle collapses into a single community (no cross-community edges → no bridges), so we
  // assert the bridges branch with an explicit two-community fixture. This exercises getInsights' read
  // logic only (no GDS), so it runs regardless of the plugin.
  it('getInsights surfaces bridge parks that connect distinct communities', async () => {
    await writeGraph(`
      MERGE (a:Park {parkCode:'zzbra'})
        SET a.fullName='ZZ Bridge A NP', a.designation='National Park',
            a.community=970001, a.pagerank=0.91, a.betweenness=2.5
      MERGE (b:Park {parkCode:'zzbrb'})
        SET b.fullName='ZZ Bridge B NP', b.designation='National Park',
            b.community=970002, b.pagerank=0.42, b.betweenness=1.1
      MERGE (a)-[s:SHARES_TOPIC]->(b) SET s.count=2
      MERGE (ca:Community {id:970001}) SET ca.size=1, ca.topTopics=['Lakes']
      MERGE (cb:Community {id:970002}) SET cb.size=1, cb.topTopics=['Geysers']
      MERGE (a)-[:IN_COMMUNITY]->(ca)
      MERGE (b)-[:IN_COMMUNITY]->(cb)
    `);
    try {
      const ins = await getInsights(50);

      const bridgeCodes = ins.bridges.map((x) => x.parkCode);
      expect(bridgeCodes).toEqual(expect.arrayContaining(['zzbra', 'zzbrb']));
      const a = ins.bridges.find((x) => x.parkCode === 'zzbra')!;
      expect(a.bridges).toBeGreaterThanOrEqual(1);
      expect(typeof a.betweenness).toBe('number');
      expect(a.betweenness).toBeCloseTo(2.5, 5); // FLOAT betweenness carried through, not toInteger'd

      // Both temp communities + central scores also surface.
      expect(ins.communities.map((c) => c.id)).toEqual(expect.arrayContaining([970001, 970002]));
      expect(ins.central.map((p) => p.parkCode)).toEqual(expect.arrayContaining(['zzbra', 'zzbrb']));
    } finally {
      await writeGraph(`MATCH (p:Park) WHERE p.parkCode IN ['zzbra','zzbrb'] DETACH DELETE p`);
      await writeGraph(`MATCH (c:Community) WHERE c.id IN [970001,970002] DETACH DELETE c`);
    }
  });

  // ── deriveCoConsidered k-anonymity (GDS-free) ───────────────────────────────
  it('deriveCoConsidered enforces a k-anon floor of 5 distinct users before materializing an edge', async () => {
    const users = Array.from({ length: 5 }, () => `zzco-${randomUUID()}`);
    await writeGraph(`MERGE (:Park {parkCode:'zzcoa'}) MERGE (:Park {parkCode:'zzcob'})`);
    const link = (u: string) =>
      writeGraph(
        `MERGE (u:User {userId:$u})
         WITH u MATCH (a:Park {parkCode:'zzcoa'}), (b:Park {parkCode:'zzcob'})
         MERGE (u)-[:CONSIDERED]->(a) MERGE (u)-[:CONSIDERED]->(b)`,
        { u },
      );
    try {
      // 4 users → below the floor → no edge.
      for (const u of users.slice(0, 4)) await link(u);
      await deriveCoConsidered();
      expect(await coConsideredUsers('zzcoa', 'zzcob')).toBeNull();

      // 5th user reaches the floor → one edge carrying the (aggregate-only) user count.
      await link(users[4]);
      await deriveCoConsidered();
      expect(await coConsideredUsers('zzcoa', 'zzcob')).toBe(5);
    } finally {
      for (const u of users) await writeGraph(`MATCH (u:User {userId:$u}) DETACH DELETE u`, { u });
      await writeGraph(`MATCH (p:Park) WHERE p.parkCode IN ['zzcoa','zzcob'] DETACH DELETE p`);
    }
  });

  it('deriveCoConsidered clamps a sub-5 minUsers up to the k-anon floor (defense in depth)', async () => {
    const users = Array.from({ length: 4 }, () => `zzco-${randomUUID()}`);
    await writeGraph(`MERGE (:Park {parkCode:'zzcoa'}) MERGE (:Park {parkCode:'zzcob'})`);
    try {
      for (const u of users) {
        await writeGraph(
          `MERGE (u:User {userId:$u})
           WITH u MATCH (a:Park {parkCode:'zzcoa'}), (b:Park {parkCode:'zzcob'})
           MERGE (u)-[:CONSIDERED]->(a) MERGE (u)-[:CONSIDERED]->(b)`,
          { u },
        );
      }
      // Even requesting minUsers=2, the floor clamps to 5, so 4 users stays below → still no edge.
      await deriveCoConsidered(2);
      expect(await coConsideredUsers('zzcoa', 'zzcob')).toBeNull();
    } finally {
      for (const u of users) await writeGraph(`MATCH (u:User {userId:$u}) DETACH DELETE u`, { u });
      await writeGraph(`MATCH (p:Park) WHERE p.parkCode IN ['zzcoa','zzcob'] DETACH DELETE p`);
    }
  });

  // ── guards (no GDS needed to probe / when GDS is absent) ─────────────────────
  it('gdsAvailable() resolves to a boolean without throwing', async () => {
    const v = await gdsAvailable();
    expect(typeof v).toBe('boolean');
    expect(v).toBe(gds); // consistent with the collection-time probe
  });

  // Runs ONLY on a Neo4j WITHOUT GDS (auto-skips on the GDS-equipped CI container): proves the
  // inside-the-fn guard no-ops cleanly to {skipped:1} instead of throwing.
  it.skipIf(gds)('derive fns no-op with {skipped:1} when GDS is unavailable', async () => {
    const c = await deriveCommunities();
    expect(c).toMatchObject({ communities: 0, named: 0, skipped: 1 });
    const ce = await deriveCentrality();
    expect(ce).toMatchObject({ pagerank: 0, betweenness: 0, skipped: 1 });
  });
});
