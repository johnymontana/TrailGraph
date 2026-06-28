import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { setCampPreferences, getCampPreferences, setCampAmenityNeeds } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Remember the user's STANDING camp preferences (Campgrounds feature): a single `(:User)-[:PREFERS_CAMP]->
 * (:CampPrefs)` anchor (mirrors set_trail_preferences). Honored as defaults by find_campgrounds, and
 * injected into the system prompt every turn. Durable — confirm scope first (standing vs just-this-trip):
 * for a one-trip-only filter, pass the constraints to find_campgrounds instead. A null field keeps the
 * saved value. Setting a hookup level also records the matching amenity REQUIRES so search honors it free.
 * userId-bound (R4).
 */
export default defineTool({
  description:
    "Remember the user's STANDING camp preferences (rig type + length, hookups, tent ok, ADA, pets, quiet, max $/night) so every campground search honors them. Durable — confirm the scope first (standing vs just this trip). For a one-trip-only need, pass those constraints to find_campgrounds instead of saving here.",
  inputSchema: z.object({
    rig: z.enum(['tent', 'rv', 'trailer', 'van', 'cabin']).optional(),
    maxLengthFt: z.number().optional().describe('RV/trailer length in feet'),
    hookups: z.enum(['none', '30amp', '50amp', 'full']).optional(),
    tentOk: z.boolean().optional(),
    ada: z.boolean().optional(),
    pets: z.boolean().optional(),
    quiet: z.boolean().optional().describe('Prefers quiet / no generators'),
    budget: z.number().optional().describe('Max $/night'),
  }),
  async execute(args, ctx) {
    const userId = callerId(ctx);
    await setCampPreferences(userId, args);
    // A hookup preference also becomes an amenity REQUIRES so find_campgrounds honors it for free.
    const amenIds =
      args.hookups === '30amp' ? ['amen:hookup-30amp']
      : args.hookups === '50amp' ? ['amen:hookup-50amp']
      : args.hookups === 'full' ? ['amen:full-hookup']
      : [];
    if (amenIds.length) await setCampAmenityNeeds(userId, amenIds);
    return { kind: 'map_snippet', data: { saved: true, campPreferences: await getCampPreferences(userId) } };
  },
});
