import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { submitReading, skyLeaderboard } from '../../lib/readings';
import { parkDetail } from '../../lib/queries';
import { callerId } from '../../lib/agent-ctx';

/**
 * Log a user's sky-darkness (SQM) reading for a park (Collective Intelligence v2, ADR-053) and show the
 * community leaderboard. SQM is mag/arcsec² (~16 bright city … ~22 pristine); validated server-side.
 * Privacy: only counts toward the public leaderboard if the user has opted in (shareCollective).
 * userId server-bound (R4). Renders the `leaderboard_card`.
 */
export default defineTool({
  description:
    "Log the user's own sky-darkness reading (SQM, ~16 city … ~22 pristine) for a park, then show the " +
    'community SQM leaderboard. parkCode + sqm required; optional date YYYY-MM-DD. Only call when the ' +
    'user reports an actual measurement they took.',
  inputSchema: z.object({
    parkCode: z.string(),
    sqm: z.number().describe('Sky Quality Meter reading in mag/arcsec² (16–22).'),
    date: z.string().optional(),
  }),
  async execute({ parkCode, sqm, date }, ctx) {
    const userId = callerId(ctx);
    const result = await submitReading(userId, parkCode, sqm, date);
    if (!result.ok) return { kind: 'leaderboard_card', data: { error: result.error } };
    const park = await parkDetail(parkCode);
    return {
      kind: 'leaderboard_card',
      data: {
        submitted: { parkCode, parkName: park?.name ?? parkCode, sqm },
        entries: await skyLeaderboard(),
      },
    };
  },
});
