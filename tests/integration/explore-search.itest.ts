import { it, expect, beforeAll, afterAll, describe } from 'vitest';
import { describeIntegration } from './db';
import { seedTestData } from '../../scripts/seed-test-data';
import { closeDriver } from '../../lib/neo4j';
import { searchParks } from '../../lib/queries';
import { rankParks } from '../../lib/recommend';

/**
 * /explore faceted search + live re-rank (ADR-045/046). Regression coverage for the reported bug:
 * selecting a state showed parks outside it because the "Refine live" panel (rankParks) ignored the
 * faceted filters. The parity block locks in the invariant that the faceted grid (searchParks) and the
 * live panel (rankParks) always agree on WHICH parks qualify — they may differ only in ordering.
 *
 * Seed facts: yell∈{WY,MT,ID} Hiking/Volcanoes; grca∈{AZ} Astronomy/Hiking, dark-sky; glac∈{MT}
 * Astronomy/Hiking/Lakes, dark-sky. All three are 'National Park'.
 */
const sortCodes = (items: { parkCode: string }[]) => items.map((p) => p.parkCode).sort();

describeIntegration('explore faceted search + live re-rank (Neo4j)', () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await closeDriver();
  });

  describe('searchParks — faceted grid', () => {
    it('state: MT → yell + glac (the reported bug input)', async () => {
      expect(sortCodes((await searchParks({ stateCode: 'MT' })).items)).toEqual(['glac', 'yell']);
    });
    it('state: AZ → grca only', async () => {
      expect(sortCodes((await searchParks({ stateCode: 'AZ' })).items)).toEqual(['grca']);
    });
    it('activity: Astronomy → grca + glac', async () => {
      expect(sortCodes((await searchParks({ activity: 'Astronomy' })).items)).toEqual(['glac', 'grca']);
    });
    it('topic: Lakes → glac; Volcanoes → yell', async () => {
      expect(sortCodes((await searchParks({ topic: 'Lakes' })).items)).toEqual(['glac']);
      expect(sortCodes((await searchParks({ topic: 'Volcanoes' })).items)).toEqual(['yell']);
    });
    it('darkSky → grca + glac (certified)', async () => {
      expect(sortCodes((await searchParks({ darkSky: true })).items)).toEqual(['glac', 'grca']);
    });
    it('designation: National Park → all three', async () => {
      expect(sortCodes((await searchParks({ designation: 'National Park' })).items)).toEqual(['glac', 'grca', 'yell']);
    });
    it('q: "glacier" (fulltext) → glac', async () => {
      expect(sortCodes((await searchParks({ q: 'glacier' })).items)).toEqual(['glac']);
    });
    it('combined: MT + Astronomy → glac (yell=MT but Hiking; grca=Astronomy but AZ)', async () => {
      expect(sortCodes((await searchParks({ stateCode: 'MT', activity: 'Astronomy' })).items)).toEqual(['glac']);
    });
    it('combined contradiction: AZ + Lakes → empty', async () => {
      const r = await searchParks({ stateCode: 'AZ', topic: 'Lakes' });
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
    });
    it('total reflects the filter and paginates', async () => {
      expect((await searchParks({ stateCode: 'MT' })).total).toBe(2);
      const p1 = await searchParks({ designation: 'National Park', limit: 1, offset: 0 });
      const p2 = await searchParks({ designation: 'National Park', limit: 1, offset: 1 });
      expect(p1.items).toHaveLength(1);
      expect(p2.items).toHaveLength(1);
      expect(p1.items[0].parkCode).not.toBe(p2.items[0].parkCode); // distinct page
      expect(p1.total).toBe(3);
    });
  });

  describe('rankParks — live "Refine live" panel honors the SAME facets (regression)', () => {
    it('state MT → yell + glac, never grca (the exact bug)', async () => {
      const r = await rankParks({ stateCode: 'MT' });
      expect(sortCodes(r.items)).toEqual(['glac', 'yell']);
      expect(r.items.some((p) => p.parkCode === 'grca')).toBe(false);
      expect(r.total).toBe(2);
    });
    it('activity / topic / darkSky / designation / q all filter', async () => {
      expect(sortCodes((await rankParks({ activity: 'Astronomy' })).items)).toEqual(['glac', 'grca']);
      expect(sortCodes((await rankParks({ topic: 'Lakes' })).items)).toEqual(['glac']);
      expect(sortCodes((await rankParks({ darkSky: true })).items)).toEqual(['glac', 'grca']);
      expect(sortCodes((await rankParks({ designation: 'National Park' })).items)).toEqual(['glac', 'grca', 'yell']);
      expect(sortCodes((await rankParks({ q: 'glacier' })).items)).toEqual(['glac']);
    });
    it('facets stack with the constraint sliders (MT + Astronomy + bortle ≤ 3 → glac)', async () => {
      const r = await rankParks({ stateCode: 'MT', activity: 'Astronomy', maxBortle: 3 });
      expect(sortCodes(r.items)).toEqual(['glac']);
    });
  });

  describe('parity invariant: faceted grid and live panel agree on the qualifying set', () => {
    const combos: Record<string, unknown>[] = [
      {},
      { stateCode: 'MT' },
      { stateCode: 'AZ' },
      { stateCode: 'WY' },
      { activity: 'Astronomy' },
      { activity: 'Hiking' },
      { topic: 'Lakes' },
      { topic: 'Volcanoes' },
      { darkSky: true },
      { designation: 'National Park' },
      { amenity: 'Accessible Restrooms' },
      { q: 'glacier' },
      { q: 'national park' },
      { stateCode: 'MT', activity: 'Astronomy' },
      { stateCode: 'AZ', topic: 'Lakes' },
      { stateCode: 'MT', darkSky: true },
    ];
    it('searchParks and rankParks return identical park sets for every facet combo', async () => {
      for (const c of combos) {
        const grid = sortCodes((await searchParks({ ...c, limit: 50 })).items);
        const live = sortCodes((await rankParks({ ...c, limit: 50 })).items);
        expect(live, `mismatch for ${JSON.stringify(c)}`).toEqual(grid);
      }
    });
  });
});
