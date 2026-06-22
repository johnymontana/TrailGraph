import { readGraph } from './neo4j';

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
