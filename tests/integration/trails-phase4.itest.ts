import { it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, writeGraph } from '../../lib/neo4j';
import { parkTrailNetwork, connectedTrails, trailCrossLinks, randomTrails } from '../../lib/queries';
import { suggestLoops } from '../../lib/loop-builder';
import { saveTrail } from '../../lib/bridges';
import { setCollectiveOptIn, trailsHikersAlsoDid } from '../../lib/collective';

/**
 * Phase 4 — the ambitious layer (ADR-072): the loop builder (CONNECTS → suggestLoops), Trail↔Learn↔Journeys
 * cross-links, the collective "hikers like you also did" signal, and "surprise me", all against a real Neo4j.
 * Uses the seeded CONNECTS (Bright Angel + South Kaibab → rim-to-rim) + HIGHLIGHTS→Geology fixtures.
 */
const BRIGHT_ANGEL = 'nps:grca:bright-angel-trail';
const SOUTH_KAIBAB = 'nps:grca:south-kaibab-trail';
const STORM_POINT = 'nps:yell:storm-point-trail';

describeIntegration('Trail loop builder + cross-links + collective (ADR-072 Phase 4, Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('parkTrailNetwork returns the park trails + the seeded CONNECTS edge', async () => {
    const net = await parkTrailNetwork('grca');
    expect(net.trails.map((t) => t.id).sort()).toEqual([BRIGHT_ANGEL, SOUTH_KAIBAB]);
    expect(net.connections).toEqual([{ from: BRIGHT_ANGEL, to: SOUTH_KAIBAB, junctions: 2 }]);
  });

  it('connectedTrails finds the connected trail in BOTH directions (stored one-way, matched undirected)', async () => {
    expect((await connectedTrails(BRIGHT_ANGEL)).map((c) => c.id)).toContain(SOUTH_KAIBAB);
    expect((await connectedTrails(SOUTH_KAIBAB)).map((c) => c.id)).toContain(BRIGHT_ANGEL);
  });

  it('suggestLoops over the live network stitches the rim-to-rim pair (summed length)', async () => {
    const net = await parkTrailNetwork('grca');
    const pair = suggestLoops(net.trails, net.connections).find((l) => l.kind === 'pair')!;
    expect(pair.trailIds.sort()).toEqual([BRIGHT_ANGEL, SOUTH_KAIBAB]);
    expect(pair.lengthMiles).toBe(16.6); // 9.5 + 7.1
    expect(pair.estTimeHrs).toBeGreaterThan(0);
  });

  it('a loop-type trail surfaces as a single loop (Storm Point)', async () => {
    const net = await parkTrailNetwork('yell');
    const loops = suggestLoops(net.trails, net.connections);
    expect(loops.some((l) => l.kind === 'single' && l.trailIds[0] === STORM_POINT)).toBe(true);
  });

  it('trailCrossLinks ties a trail to its scenery topic + a topic-linked lesson', async () => {
    const links = await trailCrossLinks(BRIGHT_ANGEL);
    expect(links.topics).toContain('Geology');
    // lesson-yell-geology RELATES_TO_TOPIC top-geology, which Bright Angel HIGHLIGHTS → cross-linked
    expect(links.lessons.map((l) => l.id)).toContain('lesson-yell-geology');
    expect(Array.isArray(links.people)).toBe(true);
  });

  it('randomTrails returns a real seeded trail', async () => {
    const [t] = await randomTrails(1);
    expect(t?.id).toMatch(/^nps:/);
  });

  it('trailsHikersAlsoDid surfaces trails done by similar opted-in hikers, privacy-gated', async () => {
    const me = `test-${randomUUID()}`;
    const other = `test-${randomUUID()}`;
    try {
      await setCollectiveOptIn(me, true);
      await setCollectiveOptIn(other, true);
      // Both did Bright Angel (the shared trail → "similar"); the other ALSO did South Kaibab.
      await saveTrail(me, BRIGHT_ANGEL, 'did');
      await saveTrail(other, BRIGHT_ANGEL, 'did');
      await saveTrail(other, SOUTH_KAIBAB, 'did');

      const picks = await trailsHikersAlsoDid(me, 8);
      const sk = picks.find((p) => p.id === SOUTH_KAIBAB);
      expect(sk).toBeTruthy();
      expect(sk!.hikers).toBeGreaterThanOrEqual(1);
      expect(sk!.parkName).toBe('Grand Canyon National Park'); // park context for the trail card (ADR-073 fix)
      expect(picks.map((p) => p.id)).not.toContain(BRIGHT_ANGEL); // not a trail `me` already did

      // opt-out → no collective data for a non-participant
      await setCollectiveOptIn(me, false);
      expect(await trailsHikersAlsoDid(me, 8)).toEqual([]);
    } finally {
      await writeGraph(`MATCH (u:User) WHERE u.userId IN $ids DETACH DELETE u`, { ids: [me, other] });
    }
  });
});
