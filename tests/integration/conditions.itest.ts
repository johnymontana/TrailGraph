import { it, expect, beforeAll, afterAll } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { buildParkConditions } from '../../lib/conditions';

/**
 * Per-stop conditions derivation against real Neo4j (ADR-042). Asserts the graph-derived fields
 * (dark-sky rating from Bortle, certification); weather is a live network fetch, so it's tolerated as
 * null (offline CI) or shape-checked when present.
 */
describeIntegration('buildParkConditions (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  it('derives the dark-sky scorecard from the seeded Bortle scale (grca = Bortle 2 → 5 stars)', async () => {
    const c = await buildParkConditions('grca', 0);
    expect(c).not.toBeNull();
    expect(c!.parkCode).toBe('grca');
    expect(c!.order).toBe(0);
    expect(c!.darkSky?.bortleScale).toBe(2);
    expect(c!.darkSky?.darkSkyCertified).toBe(true);
    expect(c!.darkSky?.rating?.stars).toBe(5);
    // Weather is a live Open-Meteo fetch — tolerate offline; shape-check when present.
    if (c!.weather) {
      expect(typeof c!.weather.condition).toBe('string');
      expect(['cold', 'cool', 'mild', 'warm', 'hot', null]).toContain(c!.tempBand);
    }
  });

  it('surfaces crowd level + quietest months for a synced park (glac)', async () => {
    const c = await buildParkConditions('glac');
    expect(c).not.toBeNull();
    expect(c!.crowdLevel).toBe('high'); // seeded
    // seeded bestMonths [5,9]; monthNames is 1-indexed (MONTHS[m-1]) → "May, Sep".
    expect(c!.bestMonths).toContain('May');
    expect(c!.bestMonths).toContain('Sep');
  });

  it('returns null for an unknown park', async () => {
    expect(await buildParkConditions('nope')).toBeNull();
  });
});
