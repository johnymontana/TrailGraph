import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, readGraph, writeGraph } from '../../lib/neo4j';
import { searchParks, parkDetail, journeyTrail } from '../../lib/queries';
import { considerPark, deleteConsidered } from '../../lib/bridges';
import { getUserMemory } from '../../lib/memory-graph';

/**
 * New-user friction-log round (ADR-038/039): card badges on the park summary, the park-hero image
 * fallback, considered-edge provenance, and the thematic-trail shape that feeds the mini-graph. Reads
 * the seeded fixtures (yell/grca/glac + Ferdinand Hayden across yell+glac). User/considered edges are
 * userId-scoped and cleaned up.
 */
describeIntegration('new-user UX friction (Neo4j)', () => {
  const userId = `test-${randomUUID()}`;
  const tempParkCode = `test-hero-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await deleteConsidered(userId, 'yell').catch(() => {});
    await writeGraph(`MATCH (u:User {userId:$userId}) DETACH DELETE u`, { userId }).catch(() => {});
    await writeGraph(`MATCH (p:Park {parkCode:$tempParkCode}) DETACH DELETE p`, { tempParkCode }).catch(() => {});
    await closeDriver();
  });

  // ── Card badges on PARK_SUMMARY_RETURN (ADR-039 P2.10) ───────────────────
  it('searchParks exposes darkSky + accessible flags derived from §5 props', async () => {
    const { items } = await searchParks({ limit: 100 });
    const by = (code: string) => items.find((p) => p.parkCode === code)!;

    // grca: darkSkyCertified=true (Bortle 2) but no campground → dark-sky badge, no accessibility badge.
    expect(by('grca').darkSky).toBe(true);
    expect(by('grca').accessible).toBe(false);

    // yell: no dark-sky props, but cg-canyon is wheelchair-accessible → accessibility badge, no dark-sky.
    expect(by('yell').darkSky).toBe(false);
    expect(by('yell').accessible).toBe(true);

    // glac: dark-sky certified, no accessible campground in fixtures.
    expect(by('glac').darkSky).toBe(true);
    expect(by('glac').accessible).toBe(false);
  });

  // ── Park hero image fallback (ADR-039 #7) ────────────────────────────────
  it('parkDetail lifts p.images into the hero when imagesFull is empty', async () => {
    // A park with a plain image URL list but an empty rich imagesFull blob (the friction-#7 shape).
    await writeGraph(
      `MERGE (p:Park {parkCode:$code})
       SET p.fullName=$name, p.designation='National Monument', p.states='UT',
           p.images=['https://www.nps.gov/test/hero.jpg'], p.imagesFull='[]',
           p.entranceFees='[]', p.operatingHours='[]', p.contacts='{}'`,
      { code: tempParkCode, name: 'Hero Fallback Test' },
    );
    const park = await parkDetail(tempParkCode);
    expect(park).not.toBeNull();
    expect(park!.images).toEqual([{ url: 'https://www.nps.gov/test/hero.jpg' }]);
  });

  it('parkDetail still prefers the rich imagesFull when present (yell fixture)', async () => {
    const park = await parkDetail('yell');
    // yell seeds both images + imagesFull → the rich record wins (object with url).
    expect((park!.images as { url: string }[])[0].url).toBe('https://www.nps.gov/test/yell.jpg');
  });

  // ── Considered provenance (ADR-039 #10 / P2.9) ───────────────────────────
  it('getUserMemory returns the CONSIDERED edge source so /me can explain "why considered"', async () => {
    await considerPark(userId, 'yell', 'agent_recommendation');
    const mem = await getUserMemory(userId);
    const entry = mem.considered.find((c) => c.parkCode === 'yell');
    expect(entry).toBeTruthy();
    expect(entry!.source).toBe('agent_recommendation');
  });

  it('a different source is preserved per the action that created the edge', async () => {
    await considerPark(userId, 'yell', 'saved'); // re-MERGE overwrites the source on the same edge
    const mem = await getUserMemory(userId);
    expect(mem.considered.find((c) => c.parkCode === 'yell')!.source).toBe('saved');
  });

  // ── Thematic trail shape feeding the mini-graph (ADR-039 P1.5) ───────────
  it('journeyTrail returns parkCode + name per park, ready for trailToNvl', async () => {
    const trail = await journeyTrail({ person: 'Ferdinand Hayden' });
    const codes = trail.map((p) => p.parkCode);
    expect(codes).toEqual(expect.arrayContaining(['yell', 'glac'])); // seeded ASSOCIATED_WITH both
    for (const p of trail) {
      expect(typeof p.parkCode).toBe('string');
      expect(typeof p.name).toBe('string');
    }
  });

  it('the considered edge actually exists in the graph with its source (provenance is durable)', async () => {
    const rows = await readGraph<{ source: string }>(
      `MATCH (:User {userId:$userId})-[r:CONSIDERED]->(:Park {parkCode:'yell'}) RETURN r.source AS source`,
      { userId },
    );
    expect(rows[0]?.source).toBe('saved');
  });
});
