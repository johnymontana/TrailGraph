import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { recordPass, getHeldPasses } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Remember that the user holds an entrance pass (NPS-expansion P2 #9): `(:User)-[:HOLDS]->(:EntrancePass)`.
 * Defaults to the national America the Beautiful annual pass. Once recorded, the trip cost model treats
 * those parks as already covered ("you already have the annual pass, so these parks are free"). Call
 * when the user says they have a pass. userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Remember that the user holds an entrance pass (defaults to the America the Beautiful annual pass) so trip costs reflect it.",
  inputSchema: z.object({
    passId: z.string().optional().describe("Pass id; omit for the America the Beautiful annual pass"),
  }),
  async execute({ passId }, ctx) {
    const userId = callerId(ctx);
    await recordPass(userId, passId);
    return { kind: 'map_snippet', data: { saved: true, passes: await getHeldPasses(userId) } };
  },
});
