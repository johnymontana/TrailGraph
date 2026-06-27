import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkTrailNetwork, trailDetail } from '../../lib/queries';
import { suggestLoops } from '../../lib/loop-builder';

/**
 * Loop builder (ADR-072, Phase 4) — the graph-over-vector payoff: stitch a park's CONNECTED trails into
 * hikeable loops with combined length / elevation / Naismith time ("link Bright Angel + South Kaibab for a
 * rim-to-rim"). Reads the materialized `(:Trail)-[:CONNECTS]->(:Trail)` network + the pure `suggestLoops`.
 * Lengths/times are estimates — keep the safety disclaimer.
 */
export default defineTool({
  description:
    "Stitch a park's connected trails into hikeable LOOPS with combined length, elevation gain, and estimated time (e.g. 'link Bright Angel + South Kaibab for a rim-to-rim'). Pass a parkCode, or a trailId to use that trail's park. Optional maxMiles. Lengths/times are estimates, not a safety guarantee.",
  inputSchema: z.object({
    parkCode: z.string().optional(),
    trailId: z.string().optional().describe("Start from this trail's park when no parkCode is known"),
    maxMiles: z.number().optional().describe('Only loops up to this many miles'),
    limit: z.number().min(1).max(12).default(6),
  }),
  async execute({ parkCode, trailId, maxMiles, limit }) {
    let pc = parkCode;
    if (!pc && trailId) {
      const t = await trailDetail(trailId);
      pc = t?.parkCode ?? undefined;
    }
    if (!pc) return { kind: 'loop_card', data: { error: 'Tell me a park (or a trail) to build loops in.' } };

    const { trails, connections } = await parkTrailNetwork(pc);
    let loops = suggestLoops(trails, connections);
    if (maxMiles != null) loops = loops.filter((l) => l.lengthMiles <= maxMiles);
    loops = loops.slice(0, limit);
    return { kind: 'loop_card', data: { parkCode: pc, loops } };
  },
});
