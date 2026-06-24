import { writeGraph } from '../neo4j';

/**
 * Geographic regions (plan F9) — a curated state→region partition for discovery + tighter trip-candidate
 * clustering. `(:Region {name})<-[:IN_REGION]-(:Park)`. A park spanning states joins each state's region.
 * Curated (like darksky.ts); pure `regionForState` is unit-tested.
 */
export const STATE_TO_REGION: Record<string, string> = {
  // Pacific West
  CA: 'Pacific West', OR: 'Pacific West', WA: 'Pacific West', NV: 'Pacific West', HI: 'Pacific West',
  // Alaska
  AK: 'Alaska',
  // Rocky Mountains
  MT: 'Rocky Mountains', WY: 'Rocky Mountains', CO: 'Rocky Mountains', UT: 'Rocky Mountains', ID: 'Rocky Mountains',
  // Southwest
  AZ: 'Southwest', NM: 'Southwest', TX: 'Southwest', OK: 'Southwest',
  // Midwest
  ND: 'Midwest', SD: 'Midwest', NE: 'Midwest', KS: 'Midwest', MN: 'Midwest', IA: 'Midwest',
  MO: 'Midwest', WI: 'Midwest', IL: 'Midwest', IN: 'Midwest', MI: 'Midwest', OH: 'Midwest',
  // Southeast
  AR: 'Southeast', LA: 'Southeast', MS: 'Southeast', AL: 'Southeast', GA: 'Southeast', FL: 'Southeast',
  TN: 'Southeast', KY: 'Southeast', SC: 'Southeast', NC: 'Southeast', VA: 'Southeast', WV: 'Southeast',
  // Northeast
  ME: 'Northeast', NH: 'Northeast', VT: 'Northeast', MA: 'Northeast', RI: 'Northeast', CT: 'Northeast',
  NY: 'Northeast', NJ: 'Northeast', PA: 'Northeast', MD: 'Northeast', DE: 'Northeast', DC: 'Northeast',
  // Pacific Islands & Territories
  PR: 'Islands & Territories', VI: 'Islands & Territories', GU: 'Islands & Territories',
  AS: 'Islands & Territories', MP: 'Islands & Territories',
};

/** Region for a 2-letter state code, or null if unmapped. Pure (unit-tested). */
export function regionForState(code: string): string | null {
  return STATE_TO_REGION[(code ?? '').trim().toUpperCase()] ?? null;
}

/** Materialize `(:Park)-[:IN_REGION]->(:Region)` from each park's states. Idempotent. */
export async function applyRegions(): Promise<number> {
  await writeGraph(`MATCH (:Park)-[r:IN_REGION]->(:Region) DELETE r`);
  const rows = Object.entries(STATE_TO_REGION).map(([state, region]) => ({ state, region }));
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS m
     MATCH (p:Park)-[:LOCATED_IN]->(:State {code: m.state})
     MERGE (reg:Region {name: m.region})
     MERGE (p)-[:IN_REGION]->(reg)
     RETURN count(DISTINCT p) AS c`,
    { rows },
  );
  return r[0]?.c ?? 0;
}
