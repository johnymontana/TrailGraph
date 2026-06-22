import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';

/** Full park detail by parkCode (A2). Graph-grounded (R6). */
export default defineTool({
  description: 'Get full details for one park by its parkCode (description, fees, hours, activities, topics, active alerts).',
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }) {
    const park = await parkDetail(parkCode);
    if (!park) return { kind: 'park_card', data: { error: `No park with code ${parkCode}` } };
    return { kind: 'park_card', data: { park } };
  },
});
