import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { tripBudget } from '../../lib/queries';

/**
 * Trip entrance-fee budget (plan F2): sum the real NPS entrance fees across a set of parks for one
 * billing unit (vehicle/person/motorcycle) and report whether the $80 America the Beautiful annual pass
 * is the cheaper option. Graph-grounded from `(:Park)-[:CHARGES]->(:EntranceFee)`. Note: timed-entry
 * reservation fees are NOT included (they live in park text, not the fee array).
 */
export default defineTool({
  description:
    "Estimate total park ENTRANCE fees for a multi-park trip and whether the $80 America the Beautiful annual pass saves money. Provide parkCodes and the billing unit. Does not include timed-entry reservation fees.",
  inputSchema: z.object({
    parkCodes: z.array(z.string()).min(1).max(30),
    unit: z.enum(['vehicle', 'person', 'motorcycle']).default('vehicle'),
  }),
  async execute({ parkCodes, unit }) {
    const res = await tripBudget(parkCodes, unit);
    return { kind: 'budget_card', data: res };
  },
});
