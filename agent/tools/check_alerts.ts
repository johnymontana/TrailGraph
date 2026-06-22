import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { readGraph } from '../../lib/neo4j';

/**
 * Two-tier alert check (ADR-005): authoritative park-level AFFECTS, plus optional best-effort
 * text "mentions" of named campgrounds — clearly distinguished, never laundered into AFFECTS.
 */
export default defineTool({
  description:
    'Check active alerts (Closure/Danger/Caution/Information) for given parks. Optionally flag alerts whose text mentions specific campground names.',
  inputSchema: z.object({
    parkCodes: z.array(z.string()).min(1),
    campgroundNames: z.array(z.string()).optional(),
  }),
  async execute({ parkCodes, campgroundNames }) {
    const rows = await readGraph(
      `
      MATCH (a:Alert)-[:AFFECTS]->(p:Park)
      WHERE p.parkCode IN $parkCodes AND a.active = true
      WITH p, a,
           [n IN coalesce($cgNames, []) WHERE toLower(a.description) CONTAINS toLower(n)] AS mentions
      RETURN p.parkCode AS parkCode, p.fullName AS park,
             collect({
               id: a.id, category: a.category, title: a.title, url: a.url,
               mentionsCampgrounds: mentions   // best-effort hint only (ADR-005)
             }) AS alerts
      `,
      { parkCodes, cgNames: campgroundNames ?? [] },
    );
    return { kind: 'alert_list', data: { parks: rows } };
  },
});
