import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { trailsHikersAlsoDid } from '../../lib/collective';
import { callerId } from '../../lib/agent-ctx';

/**
 * Collective trail signal (ADR-072, Phase 4) — "hikers like you also did…": trails done by opted-in users
 * who share a trail with this user. Privacy-safe (anonymized counts, opt-in gated). Returns trail cards.
 * userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Trails that hikers like the user have also done — a privacy-safe collective signal over the shared graph (anonymized counts). Returns trail cards. Empty unless the user has opted into collective sharing and similar hikers exist.",
  inputSchema: z.object({
    limit: z.number().min(1).max(12).default(6),
  }),
  async execute({ limit }, ctx) {
    const userId = callerId(ctx);
    const rows = await trailsHikersAlsoDid(userId, limit);
    const trails = rows.map((r) => ({
      id: r.id,
      name: r.name,
      parkCode: r.parkCode,
      parkName: r.parkName,
      difficulty: r.difficulty,
      lengthMiles: r.lengthMiles,
      hikers: r.hikers,
    }));
    return { kind: 'trail_card', data: { trails, total: trails.length, collective: true } };
  },
});
