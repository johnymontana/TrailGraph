import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { checkOpen } from '../../lib/queries';

/**
 * Date-aware open/closed check (plan F1): is a park open on a given date, and what dated seasonal
 * closures apply (e.g. Going-to-the-Sun Road in winter)? Also flags national fee-free days. Graph-grounded
 * (R6) — never guessed. Render note: data is "as of last sync" and self-reported by the park, so the card
 * frames it as reported, not a safety guarantee.
 */
export default defineTool({
  description:
    "Check whether a park is open on a specific date (parkCode + date YYYY-MM-DD). Returns open/closed/unknown, any dated seasonal closures (roads/facilities), and whether the date is a national fee-free day. Use this to validate trip dates before recommending or planning.",
  inputSchema: z.object({
    parkCode: z.string(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .describe('Travel date, YYYY-MM-DD'),
  }),
  async execute({ parkCode, date }) {
    const res = await checkOpen(parkCode, date);
    if (!res) return { kind: 'hours_card', data: { error: `No park with code ${parkCode}` } };
    return { kind: 'hours_card', data: res };
  },
});
