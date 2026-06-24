import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parksWithEventOn } from '../../lib/queries';

/**
 * Parks with a scheduled event on a date (plan F4/P1-2) — via the materialized OCCURS_ON calendar, so
 * "is there an astronomy program on my new-moon night?" is a one-hop traversal. Graph-grounded (R6).
 */
export default defineTool({
  description:
    "Find parks with a scheduled event (ranger program, astronomy night, guided tour) on a specific date (YYYY-MM-DD), optionally filtered by event type (e.g. 'Astronomy'). Use for 'what's on during my visit' or pairing astronomy events with a dark-sky/new-moon plan.",
  inputSchema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    eventType: z.string().optional().describe('Optional event type, e.g. "Astronomy", "Ranger Programs"'),
  }),
  async execute({ date, eventType }) {
    const parks = await parksWithEventOn(date, eventType ?? null);
    if (!parks.length) {
      return { kind: 'park_card', data: { error: `No events found on ${date}${eventType ? ` (${eventType})` : ''}.` } };
    }
    return {
      kind: 'park_card',
      data: { parks: parks.map((p) => ({ parkCode: p.parkCode, name: p.name, matched: [`${p.title}${p.type ? ` · ${p.type}` : ''}`] })) },
    };
  },
});
