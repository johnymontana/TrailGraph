import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { readGraph } from '../../lib/neo4j';

/**
 * Filename → tool name the model sees: `parks_near`.
 * Proximity via Neo4j point index (great-circle, ADR-004 — fine for discovery/ranking).
 * Returns a discriminated `{kind,data}` payload the proxy maps to a ParkCard list (ADR-013).
 */
export default defineTool({
  description: 'Find national parks within a radius of a location, optionally filtered by activity.',
  inputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
    radiusMiles: z.number().max(500).default(150),
    activity: z.string().optional(),
  }),
  async execute({ latitude, longitude, radiusMiles, activity }) {
    const rows = await readGraph(
      `
      MATCH (p:Park)
      WHERE p.location IS NOT NULL
        AND point.distance(p.location, point({latitude:$lat, longitude:$lng})) < $meters
        ${activity ? 'AND (p)-[:OFFERS]->(:Activity {name:$activity})' : ''}
      RETURN p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation,
             point.distance(p.location, point({latitude:$lat, longitude:$lng})) / 1609.344 AS miles
      ORDER BY miles ASC LIMIT 15
      `,
      { lat: latitude, lng: longitude, meters: radiusMiles * 1609.344, activity: activity ?? null },
    );
    return { kind: 'park_card', data: { parks: rows } };
  },
});
