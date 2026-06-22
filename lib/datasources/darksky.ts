import { writeGraph } from '../neo4j';

/**
 * Dark-sky data source (§5a) — behind the AD-3 adapter pattern. There's no single free *live* API for
 * per-park dark-sky quality, so this seeds a curated dataset (DarkSky-International certified parks +
 * a Bortle-scale estimate) and writes it onto `:Park` as structured props. Swap `DARK_SKY` for a live
 * fetch (DSI list + a light-pollution raster lookup) later without touching callers.
 */
export interface DarkSkyRecord {
  parkCode: string;
  certified: boolean; // DarkSky-International certified park
  bortle: number; // 1 (pristine) … 9 (inner-city)
}

export const DARK_SKY: DarkSkyRecord[] = [
  { parkCode: 'grca', certified: true, bortle: 2 },
  { parkCode: 'brca', certified: true, bortle: 2 },
  { parkCode: 'zion', certified: true, bortle: 3 },
  { parkCode: 'arch', certified: true, bortle: 3 },
  { parkCode: 'cany', certified: true, bortle: 2 },
  { parkCode: 'care', certified: true, bortle: 2 },
  { parkCode: 'glac', certified: true, bortle: 2 },
  { parkCode: 'grte', certified: false, bortle: 3 },
  { parkCode: 'yell', certified: false, bortle: 3 },
  { parkCode: 'jotr', certified: true, bortle: 4 },
  { parkCode: 'grsm', certified: false, bortle: 4 },
  { parkCode: 'olym', certified: false, bortle: 3 },
];

/** Bortle scale → a friendly 1–5 star rating + label. Pure (unit-tested). */
export function darkSkyRating(bortle: number): { stars: number; label: string } {
  if (bortle <= 2) return { stars: 5, label: 'Excellent dark skies' };
  if (bortle <= 3) return { stars: 4, label: 'Very dark skies' };
  if (bortle <= 4) return { stars: 3, label: 'Dark skies' };
  if (bortle <= 6) return { stars: 2, label: 'Suburban skies' };
  return { stars: 1, label: 'Bright skies' };
}

/** Write the curated dark-sky props onto matching parks. Returns the count actually applied. */
export async function applyDarkSky(records: DarkSkyRecord[] = DARK_SKY): Promise<number> {
  let applied = 0;
  for (const r of records) {
    const res = await writeGraph<{ code: string }>(
      `MATCH (p:Park {parkCode:$parkCode})
       SET p.darkSkyCertified = $certified, p.bortleScale = toInteger($bortle)
       RETURN p.parkCode AS code`,
      { parkCode: r.parkCode, certified: r.certified, bortle: r.bortle },
    );
    if (res.length) applied++;
  }
  return applied;
}
