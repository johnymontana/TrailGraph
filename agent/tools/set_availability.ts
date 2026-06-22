import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { setAvailability, getAvailability } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Remember the user's travel window (NPS-expansion P2 #7): `(:User)-[:AVAILABLE {start,end}]->(:Season)`.
 * Once set, events whose dates fall inside it are surfaced ("there's a dark-sky festival during your
 * week in September"). Call when the user states when they'll travel. Dates are ISO `YYYY-MM-DD`.
 * userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Remember the user's travel dates (ISO YYYY-MM-DD) so events during their visit get surfaced.",
  inputSchema: z.object({
    start: z.string().describe('Trip start date, ISO YYYY-MM-DD'),
    end: z.string().describe('Trip end date, ISO YYYY-MM-DD'),
  }),
  async execute({ start, end }, ctx) {
    const userId = callerId(ctx);
    await setAvailability(userId, start, end);
    return { kind: 'map_snippet', data: { saved: true, availability: await getAvailability(userId) } };
  },
});
