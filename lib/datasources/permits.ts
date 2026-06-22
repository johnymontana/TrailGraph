import { writeGraph } from '../neo4j';

/**
 * Timed-entry / permit status (§4) — link-out only (NG1). Several parks now require timed-entry
 * reservations in peak season; this curated set flags them and links to Recreation.gov, pairing with
 * the campground reservation links + `.ics` export. Behind the AD-3 adapter — swap the seed for a live
 * RIDB/timed-entry feed later.
 */
export interface PermitRecord {
  parkCode: string;
  url: string;
}

export const PERMITS: PermitRecord[] = [
  { parkCode: 'arch', url: 'https://www.recreation.gov/timed-entry' }, // Arches
  { parkCode: 'romo', url: 'https://www.recreation.gov/timed-entry' }, // Rocky Mountain
  { parkCode: 'glac', url: 'https://www.recreation.gov/timed-entry' }, // Glacier (Going-to-the-Sun)
  { parkCode: 'yose', url: 'https://www.recreation.gov/timed-entry' }, // Yosemite
  { parkCode: 'mora', url: 'https://www.recreation.gov/timed-entry' }, // Mount Rainier
  { parkCode: 'shen', url: 'https://www.recreation.gov/timed-entry' }, // Shenandoah (Old Rag)
  { parkCode: 'hale', url: 'https://www.recreation.gov/timed-entry' }, // Haleakalā (sunrise)
  { parkCode: 'acad', url: 'https://www.recreation.gov/timed-entry' }, // Acadia (Cadillac Summit)
];

export async function applyPermits(records: PermitRecord[] = PERMITS): Promise<number> {
  let applied = 0;
  for (const r of records) {
    const res = await writeGraph<{ code: string }>(
      `MATCH (p:Park {parkCode:$parkCode}) SET p.timedEntry = true, p.permitUrl = $url RETURN p.parkCode AS code`,
      { parkCode: r.parkCode, url: r.url },
    );
    if (res.length) applied++;
  }
  return applied;
}
