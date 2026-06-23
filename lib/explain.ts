import { readGraph } from './neo4j';
import { getTravelConstraints } from './bridges';

/**
 * "Why this?" (D4): graph provenance for a recommendation. Traverses the canonical bridge
 * (:User)-[:PREFERS]->(:Activity|:Topic)<-[:OFFERS|HAS_TOPIC]-(:Park) and reports which of the
 * user's preferences connected to the park — including the user's original words (r.value). Also cites
 * how the park satisfies the user's accessibility/travel constraints (NPS-expansion P0 #1). Grounded in
 * the graph, so the explanation can't hallucinate (R6).
 */
export interface Explanation {
  parkCode: string;
  park: string | null;
  matches: { name: string; yourWords: string | null }[];
  accessibility: string[];
}

export async function explainRecommendation(userId: string, parkCode: string): Promise<Explanation> {
  const [rows, cons] = await Promise.all([
    readGraph<{ park: string | null; matches: { name: string; yourWords: string | null }[] }>(
      `
      MATCH (p:Park {parkCode: $parkCode})
      OPTIONAL MATCH (u:User {userId: $userId})-[r:PREFERS]->(d)
        WHERE (p)-[:OFFERS]->(d) OR (p)-[:HAS_TOPIC]->(d)
      RETURN p.fullName AS park,
             collect(DISTINCT {name: d.name, yourWords: r.value}) AS matches
      `,
      { userId, parkCode },
    ),
    readGraph<{ wheelchair: boolean | null; rv: number | null; required: string[] }>(
      `MATCH (u:User {userId:$userId})
       OPTIONAL MATCH (u)-[:TRAVELS_WITH]->(con:Constraint)
       OPTIONAL MATCH (u)-[:REQUIRES]->(am:Amenity)
       RETURN con.wheelchair AS wheelchair, con.rvMaxLengthFt AS rv,
              [x IN collect(DISTINCT am.name) WHERE x IS NOT NULL] AS required`,
      { userId },
    ).then((r) => ({
      wheelchair: r[0]?.wheelchair ?? false,
      rvMaxLengthFt: r[0]?.rv ?? null,
      requiredAmenities: r[0]?.required ?? [],
    })),
  ]);

  const accessibility: string[] = [];
  if (cons.wheelchair || cons.rvMaxLengthFt != null || cons.requiredAmenities.length > 0) {
    const acc = await readGraph<{ wheelchair: boolean; rvOk: boolean; amenities: string[] }>(
      `MATCH (p:Park {parkCode: $parkCode})
       RETURN EXISTS { (p)<-[:IN_PARK]-(c:Campground) WHERE c.wheelchairAccessible = true } AS wheelchair,
              EXISTS { (p)<-[:IN_PARK]-(c:Campground) WHERE c.rvMaxLengthFt >= $rv } AS rvOk,
              [a IN $required WHERE
                 EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name:a}) }
                 OR EXISTS { (p)<-[:IN_PARK]-(:VisitorCenter)-[:HAS_AMENITY]->(:Amenity {name:a}) }] AS amenities`,
      { parkCode, rv: cons.rvMaxLengthFt ?? 0, required: cons.requiredAmenities },
    );
    const a = acc[0];
    if (cons.wheelchair && a?.wheelchair) accessibility.push('has a wheelchair-accessible campground');
    if (cons.rvMaxLengthFt != null && a?.rvOk) accessibility.push(`has an RV site ≥ your ${cons.rvMaxLengthFt} ft`);
    for (const am of a?.amenities ?? []) accessibility.push(`has ${am}`);
  }

  const r = rows[0];
  return {
    parkCode,
    park: r?.park ?? null,
    matches: (r?.matches ?? []).filter((m) => m.name),
    accessibility,
  };
}

/**
 * "Why this park?" as literal graph edges (ADR-047). Unlike `explainRecommendation` (matched names +
 * accessibility *strings*), this returns the explanatory PATH — each preference triple
 * (You)-[:PREFERS]->(Activity|Topic)<-[:OFFERS|HAS_TOPIC]-(Park) with the relationship direction and the
 * user's original words — plus the CONCRETE node that satisfies each travel constraint (e.g. the
 * campground that fits the RV). The popover/chat card render these literally; grounded in the graph (R6).
 */
export interface PrefPath {
  name: string;
  kind: 'activity' | 'topic';
  via: 'OFFERS' | 'HAS_TOPIC';
  yourWords: string | null;
  weight: number | null;
}
export interface ConstraintProof {
  kind: 'wheelchair' | 'rv' | 'amenity';
  label: string;
  satisfiedBy: string | null;
}
export interface ExplanationGraph {
  parkCode: string;
  park: string | null;
  prefPaths: PrefPath[];
  constraints: ConstraintProof[];
}

export async function explainGraph(userId: string, parkCode: string): Promise<ExplanationGraph> {
  const cons = await getTravelConstraints(userId);

  const prefRows = await readGraph<{ park: string | null; prefPaths: PrefPath[] }>(
    `
    MATCH (p:Park {parkCode: $parkCode})
    OPTIONAL MATCH (u:User {userId: $userId})-[r:PREFERS]->(d)
      WHERE (p)-[:OFFERS]->(d) OR (p)-[:HAS_TOPIC]->(d)
    // Build the list with a CASE that yields null for the OPTIONAL-MATCH no-match row, then strip it —
    // so the 'via' CASE is only evaluated for a real (d,r) match (no spurious {name:null, via:'HAS_TOPIC'}).
    RETURN p.fullName AS park,
      [x IN collect(DISTINCT CASE WHEN d IS NULL THEN null ELSE {
        name: d.name,
        kind: CASE WHEN d:Activity THEN 'activity' ELSE 'topic' END,
        via: CASE WHEN (p)-[:OFFERS]->(d) THEN 'OFFERS' ELSE 'HAS_TOPIC' END,
        yourWords: r.value,
        weight: r.weight
      } END) WHERE x IS NOT NULL] AS prefPaths
    `,
    { userId, parkCode },
  );

  const constraints: ConstraintProof[] = [];
  if (cons.wheelchair) {
    const cg = await readGraph<{ name: string }>(
      `MATCH (cg:Campground)-[:IN_PARK]->(:Park {parkCode:$parkCode}) WHERE cg.wheelchairAccessible = true
       RETURN cg.name AS name ORDER BY cg.name LIMIT 1`,
      { parkCode },
    );
    constraints.push({ kind: 'wheelchair', label: 'wheelchair-accessible camping', satisfiedBy: cg[0]?.name ?? null });
  }
  if (cons.rvMaxLengthFt != null) {
    const cg = await readGraph<{ name: string; ft: number }>(
      `MATCH (cg:Campground)-[:IN_PARK]->(:Park {parkCode:$parkCode}) WHERE cg.rvMaxLengthFt >= $rv
       RETURN cg.name AS name, cg.rvMaxLengthFt AS ft ORDER BY cg.rvMaxLengthFt DESC LIMIT 1`,
      { parkCode, rv: cons.rvMaxLengthFt },
    );
    constraints.push({
      kind: 'rv',
      label: `fits your ${cons.rvMaxLengthFt} ft RV`,
      satisfiedBy: cg[0] ? `${cg[0].name} (≤ ${cg[0].ft} ft)` : null,
    });
  }
  if (cons.requiredAmenities.length > 0) {
    const holders = await readGraph<{ req: string; holder: string | null }>(
      // Aggregate each amenity to ONE holder. Without the intermediate WITH/collect, two consecutive
      // OPTIONAL MATCHes (Place + VisitorCenter) cartesian-product into duplicate rows when an amenity is
      // offered by both → duplicate constraint entries (review finding).
      `UNWIND $required AS req
       MATCH (p:Park {parkCode:$parkCode})
       OPTIONAL MATCH (p)-[:HAS_PLACE]->(pl:Place)-[:HAS_AMENITY]->(:Amenity {name:req})
       WITH p, req, collect(pl.title)[0] AS placeHolder
       OPTIONAL MATCH (vc:VisitorCenter)-[:IN_PARK]->(p) WHERE (vc)-[:HAS_AMENITY]->(:Amenity {name:req})
       WITH req, placeHolder, collect(vc.name)[0] AS vcHolder
       RETURN req AS req, coalesce(placeHolder, vcHolder) AS holder`,
      { parkCode, required: cons.requiredAmenities },
    );
    for (const h of holders) {
      constraints.push({ kind: 'amenity', label: h.req, satisfiedBy: h.holder ?? null });
    }
  }

  const row = prefRows[0];
  return {
    parkCode,
    park: row?.park ?? null,
    prefPaths: (row?.prefPaths ?? []).filter((p) => p.name),
    constraints,
  };
}

/**
 * Batched "because you liked …" for many parks at once (§5f) — extends the rationale beyond "For you"
 * to Similar/Nearby on park pages. Returns parkCode → matched preference names (empty if none).
 */
export async function explainForParks(userId: string, parkCodes: string[]): Promise<Record<string, string[]>> {
  if (!parkCodes.length) return {};
  const rows = await readGraph<{ parkCode: string; matched: string[] }>(
    `
    UNWIND $codes AS code
    MATCH (p:Park {parkCode: code})
    OPTIONAL MATCH (u:User {userId: $userId})-[:PREFERS]->(d)
      WHERE (p)-[:OFFERS]->(d) OR (p)-[:HAS_TOPIC]->(d)
    RETURN code AS parkCode, [x IN collect(DISTINCT d.name) WHERE x IS NOT NULL] AS matched
    `,
    { userId, codes: parkCodes },
  );
  return Object.fromEntries(rows.map((r) => [r.parkCode, r.matched]));
}
