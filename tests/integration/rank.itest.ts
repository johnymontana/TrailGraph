import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver, readGraph } from '../../lib/neo4j';
import { rankParks } from '../../lib/recommend';

/**
 * Live constraint re-ranking against real Neo4j (ADR-046) — the structured query a vector store can't do
 * cleanly. Assertions are INVARIANT-based (every returned park genuinely satisfies the hard filter, the
 * score ordering is monotonic) so they hold whether the DB is the empty CI container OR a populated one,
 * rather than asserting exact membership/ordering that only holds against seed-only data.
 */
describeIntegration('rankParks (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('hard-filters by dark-sky quality: every result has bortleScale ≤ maxBortle', async () => {
    const { items, total } = await rankParks({ maxBortle: 2, limit: 200 });
    expect(items.every((p) => p.bortleScale != null && p.bortleScale <= 2)).toBe(true);
    expect(total).toBeGreaterThanOrEqual(2); // seeded grca + glac are Bortle 2
  });

  it('hard-filters to parks that genuinely have an RV-fitting campground', async () => {
    const { items } = await rankParks({ rvMaxLengthFt: 40, limit: 200 });
    expect(items.length).toBeGreaterThan(0);
    const codes = items.map((p) => p.parkCode);
    const check = await readGraph<{ parkCode: string; ok: boolean }>(
      `MATCH (p:Park) WHERE p.parkCode IN $codes
       RETURN p.parkCode AS parkCode, EXISTS { (cg:Campground)-[:IN_PARK]->(p) WHERE cg.rvMaxLengthFt >= 40 } AS ok`,
      { codes },
    );
    expect(check.every((r) => r.ok)).toBe(true);
    expect(codes).toContain('yell'); // seeded Canyon Campground fits 40 ft
  });

  it('hard-filters to parks that genuinely have a wheelchair-accessible campground', async () => {
    const { items } = await rankParks({ wheelchairAccessible: true, limit: 200 });
    const codes = items.map((p) => p.parkCode);
    const check = await readGraph<{ ok: boolean }>(
      `MATCH (p:Park) WHERE p.parkCode IN $codes
       RETURN EXISTS { (cg:Campground)-[:IN_PARK]->(p) WHERE cg.wheelchairAccessible = true } AS ok`,
      { codes },
    );
    expect(check.every((r) => r.ok)).toBe(true);
    expect(codes).toContain('yell');
  });

  it('crowd-tolerance demotes busy parks: signed adjustment, monotonic ordering', async () => {
    const { items } = await rankParks({ crowdTolerance: 1, limit: 200 });
    const scores = items.map((p) => p.score);
    expect(scores.every((s, i) => i === 0 || scores[i - 1] >= s)).toBe(true);
    // With no userId (prefScore 0) the ordering is the signed crowd adjustment alone: low > moderate >
    // (unknown) > high > very high — so a low-crowd park must outrank a busy one, and busy parks get a
    // negative score rather than a zero "no boost".
    const firstLow = items.findIndex((p) => p.crowdLevel === 'low');
    const firstVeryHigh = items.findIndex((p) => p.crowdLevel === 'very high');
    if (firstLow !== -1 && firstVeryHigh !== -1) expect(firstLow).toBeLessThan(firstVeryHigh);
    const veryHigh = items.find((p) => p.crowdLevel === 'very high');
    if (veryHigh) expect(veryHigh.score).toBeLessThan(0); // penalized, not merely un-boosted
  });

  it('pages: items ≤ limit and total is the full filtered count', async () => {
    const { items, total } = await rankParks({ maxBortle: 2, limit: 1 });
    expect(items.length).toBeLessThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(2);
  });
});
