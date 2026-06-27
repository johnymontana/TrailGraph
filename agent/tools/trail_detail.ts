import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { trailDetail } from '../../lib/queries';

/**
 * Full detail for one trail by id (ADR-066): elevation stats, route type, difficulty (an ESTIMATE),
 * trailhead + parking, nearby services, permit need, and the curated NPS hike blurb. Geometry + the
 * elevation profile load separately on the trail page; this is the chat-side summary.
 */
export default defineTool({
  description:
    "Full detail for one trail by its id (from a trail card or finder): length, elevation gain/loss, difficulty (an estimate, not a safety guarantee), route type, trailhead + accessible parking, nearby services, whether a permit is required, and the curated NPS hike notes.",
  inputSchema: z.object({
    id: z.string().describe('Trail id, e.g. nps:grca:bright-angel-trail'),
  }),
  async execute({ id }) {
    const trail = await trailDetail(id);
    if (!trail) return { kind: 'trail_detail_card', data: { error: `No trail found for id "${id}".` } };
    return { kind: 'trail_detail_card', data: trail };
  },
});
