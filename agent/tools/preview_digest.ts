import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { buildDigest } from '../../lib/digest';
import { callerId } from '../../lib/agent-ctx';

/**
 * Preview the user's ranger digest now (Proactive Ranger, ADR-052) — builds today's rollup from their
 * watches so they can see what the daily digest will surface (closures, dark-sky windows, fee-free days,
 * alerts) without waiting for the morning cron. userId-bound (R4). Renders the `digest_card`.
 */
export default defineTool({
  description:
    "Show the user's ranger digest right now (today's closures, clear-sky windows, fee-free days, and " +
    'alerts across their watched trips/parks). Use when they ask what their digest looks like or what is ' +
    'happening with their watched trips.',
  inputSchema: z.object({}),
  async execute(_args, ctx) {
    const userId = callerId(ctx);
    const digest = await buildDigest(userId);
    return { kind: 'digest_card', data: digest };
  },
});
