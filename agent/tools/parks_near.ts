import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { readGraph } from '../../lib/neo4j';
import { getTravelConstraints, mergeConstraints } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Filename → tool name the model sees: `parks_near`.
 * Proximity via Neo4j point index (great-circle, ADR-004 — fine for discovery/ranking).
 * Returns a discriminated `{kind,data}` payload the proxy maps to a ParkCard list (ADR-013).
 *
 * P0.2: proximity and amenity/accessibility filters compose as HARD ANDed predicates here too (defense in
 * depth), so an anchored+amenity ask is correct whichever entry point the ranger picks. Durable saved
 * constraints are merged in (like find_parks); per-call overrides layer on top for a one-trip need.
 */
export default defineTool({
  description:
    'Find national parks within a radius of a location (lat/lng), optionally filtered by activity and by amenity/accessibility/RV needs. Proximity is a hard limit. Use when the ask is anchored to a point.',
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
    radiusMiles: z.number().max(500).default(150),
    activity: z.string().optional(),
    wheelchairAccessible: z.boolean().optional().describe('Require wheelchair-accessible camping (for this search only)'),
    rvMaxLengthFt: z.number().optional().describe('Require campgrounds fitting this RV length (for this search only)'),
    requiredAmenities: z.array(z.string()).optional().describe('Exact NPS amenity names to require (for this search only)'),
    preferNationalParks: z.boolean().optional().describe('Rank National Parks above monuments/memorials'),
  }),
  async execute(
    { latitude, longitude, radiusMiles, activity, wheelchairAccessible, rvMaxLengthFt, requiredAmenities, preferNationalParks },
    ctx,
  ) {
    // Start from the user's durable saved constraints, then layer per-call overrides (cf. find_parks).
    let saved = { wheelchair: false, rvMaxLengthFt: null as number | null, requiredAmenities: [] as string[] };
    try {
      saved = await getTravelConstraints(callerId(ctx));
    } catch {
      /* anonymous — no constraints to apply */
    }
    const merged = mergeConstraints(saved, { wheelchair: wheelchairAccessible, rvMaxLengthFt, requiredAmenities });
    const order = preferNationalParks
      ? `ORDER BY (CASE WHEN p.designation CONTAINS 'National Park' THEN 0 ELSE 1 END), miles ASC`
      : 'ORDER BY miles ASC';
    const rows = await readGraph(
      `
      MATCH (p:Park)
      WHERE p.location IS NOT NULL
        AND point.distance(p.location, point({latitude:$lat, longitude:$lng})) < $meters
        ${activity ? 'AND (p)-[:OFFERS]->(:Activity {name:$activity})' : ''}
        AND ($rv IS NULL OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.rvMaxLengthFt >= $rv })
        AND (NOT $wheelchair OR EXISTS { (p)<-[:IN_PARK]-(cg:Campground) WHERE cg.wheelchairAccessible = true })
        AND ALL(req IN $required WHERE
              EXISTS { (p)-[:HAS_PLACE]->(:Place)-[:HAS_AMENITY]->(:Amenity {name: req}) }
              OR EXISTS { (p)<-[:IN_PARK]-(:VisitorCenter)-[:HAS_AMENITY]->(:Amenity {name: req}) }
              OR EXISTS { (p)<-[:IN_PARK]-(:Campground)-[:HAS_AMENITY]->(:Amenity {name: req}) })
      RETURN p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation,
             p.location.latitude AS lat, p.location.longitude AS lng,
             point.distance(p.location, point({latitude:$lat, longitude:$lng})) / 1609.344 AS miles
      ${order} LIMIT 15
      `,
      {
        lat: latitude,
        lng: longitude,
        meters: radiusMiles * 1609.344,
        activity: activity ?? null,
        rv: merged.rvMaxLengthFt,
        wheelchair: merged.wheelchair,
        required: merged.requiredAmenities,
      },
    );
    return { kind: 'park_card', data: { parks: rows } };
  },
});
