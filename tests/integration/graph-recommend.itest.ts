import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { considerPark, deleteConsidered, collectStamp, uncollectStamp } from '../../lib/bridges';
import { forYouFromNode } from '../../lib/recommend';
import { userContextBridges } from '../../lib/memory-graph';

/**
 * Graph-native "recommend from here" (#9) + "you in the graph" bridges (#8) against real Neo4j (gated by
 * RUN_INTEGRATION=1, see db.ts). We write the canonical PREFERS/CONSIDERED/PLANNED/COLLECTED bridges
 * directly (bypassing NAMS, which isn't available in CI) and assert the 2-hop traversal + the bridge
 * scoping/caps. userId is random per suite and torn down in afterAll.
 *
 * Seed graph (scripts/seed-test-data.ts) — park → shared dimensions:
 *   grca  OFFERS Astronomy, Hiking
 *   glac  OFFERS Astronomy, Hiking ; HAS_TOPIC Lakes
 *   yell  OFFERS Hiking          ; HAS_TOPIC Volcanoes, Geology
 * so from the grca seed: glac shares {Astronomy, Hiking}, yell shares {Hiking}.
 */
describeIntegration('forYouFromNode + context bridges (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;

  beforeAll(async () => {
    await seedTestData();
    // Canonical PREFERS bridge: the user loves Astronomy. grca + glac OFFER it; yell does not.
    await writeGraph(
      `MATCH (a:Activity {name:'Astronomy'}) MERGE (u:User {userId:$userId})
       MERGE (u)-[r:PREFERS]->(a) SET r.category='activity', r.value='stargazing', r.at=datetime()`,
      { userId },
    );
  });
  afterAll(async () => {
    // Drop any trip/stop scaffolding we built, then the user + all its context edges.
    await writeGraph(
      `MATCH (u:User {userId:$userId})
       OPTIONAL MATCH (u)-[:PLANNED]->(t:Trip) OPTIONAL MATCH (t)-[:HAS_STOP]->(s:Stop)
       DETACH DELETE u, t, s`,
      { userId },
    ).catch(() => {});
    await closeDriver();
  });

  // ── forYouFromNode: 2-hop seed → shared-dimension → park ─────────────────────
  it("recommends 2-hop parks sharing the seed park's dimensions, excluding the seed itself", async () => {
    const { seedName, parks } = await forYouFromNode(userId, 'grca', { limit: 8 });
    const codes = parks.map((p) => p.parkCode);
    expect(seedName).toBe('Grand Canyon National Park'); // seed.fullName carried through
    expect(codes).not.toContain('grca'); // the seed itself is never recommended
    expect(codes).toEqual(expect.arrayContaining(['glac', 'yell']));
    // glac shares Astronomy(loved) + Hiking; yell shares Hiking only → glac outranks yell.
    expect(codes.indexOf('glac')).toBeLessThan(codes.indexOf('yell'));
  });

  it('populates matched (loved subset) + sharedVia, and weights loved dimensions double', async () => {
    const { parks } = await forYouFromNode(userId, 'grca', { limit: 8 });
    const byCode = Object.fromEntries(parks.map((p) => [p.parkCode, p]));
    const glac = byCode['glac'];
    const yell = byCode['yell'];
    expect(glac).toBeTruthy();
    expect(yell).toBeTruthy();

    // glac: Astronomy is loved → matched is the loved subset; sharedVia carries BOTH shared dims.
    expect(glac.matched).toEqual(['Astronomy']);
    expect(glac.sharedVia.map((s) => s.name).sort()).toEqual(['Astronomy', 'Hiking']);
    for (const s of glac.sharedVia) {
      expect(s.kind).toBe('activity');
      expect(s.via).toBe('OFFERS');
    }
    expect(glac.matches).toBe(2);

    // yell: no loved dim → matched falls back to the (first couple of) shared dim names.
    expect(yell.matched).toEqual(['Hiking']);
    expect(yell.sharedVia.map((s) => s.name)).toEqual(['Hiking']);
    expect(yell.matches).toBe(1);

    // Loved weighting (the 2.0 vs 1.0): glac = 2(loved Astronomy) + 1(Hiking) = 3; yell = 1.
    expect((glac as unknown as { score: number }).score).toBe(3);
    expect((yell as unknown as { score: number }).score).toBe(1);
  });

  // ── Novelty filters ──────────────────────────────────────────────────────────
  it('excludes a park the user has already CONSIDERED (novelty)', async () => {
    await considerPark(userId, 'glac', 'viewed');
    try {
      const codes = (await forYouFromNode(userId, 'grca')).parks.map((p) => p.parkCode);
      expect(codes).not.toContain('glac'); // considered → filtered out
      expect(codes).toContain('yell'); // still fresh
    } finally {
      await deleteConsidered(userId, 'glac');
    }
  });

  it('excludes a park the user has PLANNED in a trip (novelty EXISTS path)', async () => {
    const tripId = randomUUID();
    // Build PLANNED→Trip→HAS_STOP→Stop→OF_PARK→yell directly. We deliberately bypass addStop (which
    // would ALSO write a CONSIDERED bridge) so this isolates the PLANNED EXISTS branch.
    await writeGraph(
      `MATCH (u:User {userId:$userId}), (p:Park {parkCode:'yell'})
       CREATE (t:Trip {id:$tripId, userId:$userId}) SET t.name='Planned test'
       MERGE (u)-[:PLANNED]->(t)
       CREATE (s:Stop {id:$stopId, kind:'park', order:0})
       MERGE (t)-[:HAS_STOP]->(s) MERGE (s)-[:OF_PARK]->(p)`,
      { userId, tripId, stopId: randomUUID() },
    );
    try {
      const codes = (await forYouFromNode(userId, 'grca')).parks.map((p) => p.parkCode);
      expect(codes).not.toContain('yell'); // excluded via PLANNED→…→OF_PARK
      expect(codes).toContain('glac'); // not planned/considered → still recommended
    } finally {
      await writeGraph(
        `MATCH (t:Trip {id:$tripId}) OPTIONAL MATCH (t)-[:HAS_STOP]->(s:Stop) DETACH DELETE t, s`,
        { tripId },
      );
    }
  });

  it('returns an empty list when novelty filters exhaust every 2-hop match', async () => {
    // From the glac seed the 2-hop matches are grca + yell + zion (all OFFER Hiking; grca also shares
    // Astronomy). Mark all CONSIDERED → no fresh recs survive the WHERE novelty filter.
    await considerPark(userId, 'grca', 'viewed');
    await considerPark(userId, 'yell', 'viewed');
    await considerPark(userId, 'zion', 'viewed');
    try {
      const { seedName, parks } = await forYouFromNode(userId, 'glac');
      expect(parks).toEqual([]);
      // Even when novelty filters exhaust every match, seedName is fetched independently so the caller can
      // still render "No fresh recommendations from <SeedName>" with the real park name.
      expect(seedName).toBe('Glacier National Park');
    } finally {
      await deleteConsidered(userId, 'grca');
      await deleteConsidered(userId, 'yell');
      await deleteConsidered(userId, 'zion');
    }
  });

  // ── userContextBridges (#8): pref / trip / stamp bridges, scoping + caps ──────
  it('returns pref/trip/stamp bridges scoped to the given parkCodes', async () => {
    const tripId = randomUUID();
    await writeGraph(
      `MATCH (u:User {userId:$userId}), (p:Park {parkCode:'yell'})
       CREATE (t:Trip {id:$tripId, userId:$userId}) SET t.name='Bridge trip'
       MERGE (u)-[:PLANNED]->(t)
       CREATE (s:Stop {id:$stopId, kind:'park', order:0})
       MERGE (t)-[:HAS_STOP]->(s) MERGE (s)-[:OF_PARK]->(p)`,
      { userId, tripId, stopId: randomUUID() },
    );
    await collectStamp(userId, 'stamp-yell-canyon'); // PassportStamp IN_PARK yell
    try {
      const bridges = await userContextBridges(userId, ['grca', 'glac', 'yell']);

      // PREFERS Astronomy → OFFERS bridges to grca + glac (NOT yell, which lacks Astronomy).
      const prefs = bridges.filter((b) => b.fromKind === 'activity');
      expect(prefs).toEqual(
        expect.arrayContaining([
          { fromKind: 'activity', fromKey: 'Astronomy', via: 'OFFERS', parkCode: 'grca' },
          { fromKind: 'activity', fromKey: 'Astronomy', via: 'OFFERS', parkCode: 'glac' },
        ]),
      );
      expect(prefs.some((b) => b.parkCode === 'yell')).toBe(false);

      // Trip bridge (INCLUDES) + stamp bridge (AT), both pointing at yell.
      expect(bridges).toEqual(
        expect.arrayContaining([
          { fromKind: 'trip', fromKey: tripId, via: 'INCLUDES', parkCode: 'yell' },
          { fromKind: 'stamp', fromKey: 'stamp-yell-canyon', via: 'AT', parkCode: 'yell' },
        ]),
      );

      // Scoping: restrict to ['glac'] → only the Astronomy→glac pref bridge (yell trip/stamp drop out).
      const scoped = await userContextBridges(userId, ['glac']);
      expect(scoped).toEqual([
        { fromKind: 'activity', fromKey: 'Astronomy', via: 'OFFERS', parkCode: 'glac' },
      ]);
    } finally {
      await uncollectStamp(userId, 'stamp-yell-canyon');
      await writeGraph(
        `MATCH (t:Trip {id:$tripId}) OPTIONAL MATCH (t)-[:HAS_STOP]->(s:Stop) DETACH DELETE t, s`,
        { tripId },
      );
    }
  });

  it('returns no bridges for an empty parkCodes set (short-circuit, no query)', async () => {
    expect(await userContextBridges(userId, [])).toEqual([]);
  });

  it('respects the global maxBridges cap and the per-preference cap', async () => {
    // Only the PREFERS Astronomy edge is active now (trip/stamp cleaned up). It touches grca + glac.
    const full = await userContextBridges(userId, ['grca', 'glac']);
    expect(full.filter((b) => b.fromKey === 'Astronomy')).toHaveLength(2);

    // perPrefCap:1 collapses Astronomy's two parks to one bridge.
    const perPref = await userContextBridges(userId, ['grca', 'glac'], { perPrefCap: 1 });
    expect(perPref.filter((b) => b.fromKey === 'Astronomy')).toHaveLength(1);

    // maxBridges:1 slices the whole result to a single bridge.
    const capped = await userContextBridges(userId, ['grca', 'glac'], { maxBridges: 1 });
    expect(capped).toHaveLength(1);
  });
});
