import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { applyVisitation } from '../../lib/datasources/visitation';
import { NPS_VISITATION } from '../../lib/datasources/visitation-data';
import { parkDetail } from '../../lib/queries';

/**
 * Real NPS visitation import (ADR — park data-viz). Verifies `applyVisitation` writes the bundled NPS
 * dataset onto matching parks and that `parkDetail` then surfaces a 12-month array + derived
 * bestMonths/crowdLevel — the data the visitation chart + calendar render from.
 */
describeIntegration('NPS visitation import (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
    await applyVisitation(); // writes the bundled NPS dataset onto existing parks
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('writes real monthly visitation onto a seeded park present in the dataset', async () => {
    const npsGrca = NPS_VISITATION.find((r) => r.parkCode === 'grca');
    expect(npsGrca, 'grca should be in the bundled NPS dataset').toBeTruthy();

    const detail = await parkDetail('grca');
    expect(detail).not.toBeNull();
    const monthly = detail!.monthlyVisits as number[];
    expect(monthly).toHaveLength(12);
    expect(monthly).toEqual(npsGrca!.monthly); // the real NPS numbers, not the curated fallback
    expect((detail!.annualVisits as number) ?? 0).toBeGreaterThan(0);
  });

  it('derives bestMonths + crowdLevel from the imported data', async () => {
    const detail = await parkDetail('yell');
    expect((detail!.bestMonths as number[]).length).toBeGreaterThan(0);
    expect(['low', 'moderate', 'high', 'very high']).toContain(detail!.crowdLevel as string);
    // Yellowstone is a very busy park.
    expect(detail!.crowdLevel).toBe('very high');
  });
});
