import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { parksInBBox, allParksGeo, parkCodesByFacet, parksWithConditionFacts, parkEdgesInBBox } from '../../lib/queries';

/**
 * The map BFF read queries the /map instrument layers ride on (#3/#4/#5/#8/#12). Seeded parks:
 * yell (44.6,-110.5), glac (48.7,-113.8), grca (36.1,-112.1). The NW box contains yell + glac, excludes grca.
 */
const NW = { minLat: 40, minLng: -116, maxLat: 50, maxLng: -108 };

describeIntegration('map BFF queries (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('parksInBBox returns only parks inside the viewport', async () => {
    const codes = (await parksInBBox(NW)).map((p) => p.parkCode);
    expect(codes).toContain('yell');
    expect(codes).toContain('glac');
    expect(codes).not.toContain('grca');
  });

  it('allParksGeo carries the lens facets the recolor uses (#3)', async () => {
    const all = await allParksGeo();
    const grca = all.find((p) => p.parkCode === 'grca');
    const glac = all.find((p) => p.parkCode === 'glac');
    expect(grca?.feeFree).toBe(true); // grca seeded fee-free
    expect(glac?.darkSky).toBe(true); // glac dark-sky certified (Bortle 2)
    expect(grca).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
  });

  it('parkCodesByFacet ANDs state / activity / topic (#8b)', async () => {
    expect((await parkCodesByFacet({ activity: 'Astronomy' })).sort()).toEqual(['glac', 'grca']);
    // HAS_TOPIC tagging: yell→{Geology, Volcanoes}, glac→{Lakes} (grca has no direct HAS_TOPIC edge).
    expect((await parkCodesByFacet({ topic: 'Geology' })).sort()).toEqual(['yell']);
    expect((await parkCodesByFacet({ topic: 'Lakes' })).sort()).toEqual(['glac']);
    expect((await parkCodesByFacet({ stateCode: 'MT' })).sort()).toEqual(['glac', 'yell']);
  });

  it('parksWithConditionFacts flags an active alert (#4)', async () => {
    const yell = (await parksWithConditionFacts(NW)).find((p) => p.parkCode === 'yell');
    expect(yell?.alert).toBe(true); // seeded active Closure alert (alert-test-1)
  });

  it('parkEdgesInBBox returns materialized NEAR edges within the box (#5)', async () => {
    // The seed has no derived edges; materialize one yell↔glac NEAR for the assertion, then remove it.
    // Distances stay FLOAT (never toInteger) per the Neo4j-v6 gotcha.
    await writeGraph(`MATCH (a:Park {parkCode:'yell'}),(b:Park {parkCode:'glac'}) MERGE (a)-[r:NEAR]->(b) SET r.miles = 230.0`, {});
    try {
      const near = await parkEdgesInBBox(NW, 'near');
      const edge = near.find((e) => (e.aCode === 'yell' && e.bCode === 'glac') || (e.aCode === 'glac' && e.bCode === 'yell'));
      expect(edge, 'the NEAR edge should be returned').toBeTruthy();
      expect(edge!.weight).toBeCloseTo(230, 0);
      // No SHARES_TOPIC edges seeded → the topic kind is a clean empty array, never an error.
      expect(Array.isArray(await parkEdgesInBBox(NW, 'topic'))).toBe(true);
    } finally {
      await writeGraph(`MATCH (:Park {parkCode:'yell'})-[r:NEAR]->(:Park {parkCode:'glac'}) DELETE r`, {});
    }
  });
});
