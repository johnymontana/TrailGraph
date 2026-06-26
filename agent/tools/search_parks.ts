import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { readGraph } from '../../lib/neo4j';

/** Full-text + facet search over parks (A1). Graph-grounded results only (R6). */
export default defineTool({
  description:
    'Search national parks by free text and optional facets (state code, activity, topic, designation).',
  inputSchema: z.object({
    query: z.string().optional(),
    stateCode: z.string().length(2).optional(),
    activity: z.string().optional(),
    topic: z.string().optional(),
    designation: z.string().optional(),
    limit: z.number().max(25).default(10),
  }),
  async execute({ query, stateCode, activity, topic, designation, limit }) {
    const rows = await readGraph(
      `
      ${query ? `CALL db.index.fulltext.queryNodes('park_fulltext', $query) YIELD node AS p, score` : `MATCH (p:Park) WITH p, 0.0 AS score`}
      ${stateCode ? 'WHERE (p)-[:LOCATED_IN]->(:State {code:$stateCode})' : ''}
      ${activity ? `${stateCode ? 'AND' : 'WHERE'} (p)-[:OFFERS]->(:Activity {name:$activity})` : ''}
      ${topic ? `${stateCode || activity ? 'AND' : 'WHERE'} (p)-[:HAS_TOPIC]->(:Topic {name:$topic})` : ''}
      ${designation ? `${stateCode || activity || topic ? 'AND' : 'WHERE'} p.designation = $designation` : ''}
      RETURN p.parkCode AS parkCode, p.fullName AS name, p.designation AS designation,
             p.location.latitude AS lat, p.location.longitude AS lng,
             p.states AS states, score
      ORDER BY score DESC, name ASC LIMIT toInteger($limit)
      `,
      {
        query: query ?? null,
        stateCode: stateCode ?? null,
        activity: activity ?? null,
        topic: topic ?? null,
        designation: designation ?? null,
        limit,
      },
    );
    return { kind: 'park_card', data: { parks: rows } };
  },
});
