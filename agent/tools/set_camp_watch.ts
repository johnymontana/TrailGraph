import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { searchCampgrounds } from '../../lib/campgrounds';
import { createCampWatch, listCampWatches } from '../../lib/camp-watches';
import { callerId } from '../../lib/agent-ctx';

/**
 * Set a Camp Watch — cancellation alerting (Campgrounds feature). A `:CampWatch` stores the criteria; the
 * poller diffs availability every 15 min and alerts (in-app + opt-in email) when a matching site frees up.
 * This is durable — confirm the user actually wants ongoing alerts before saving. Give explicit
 * campgroundIds OR a parkCode (we resolve the in/near-park reservable campgrounds). userId-bound (R4).
 * The ranger never books — a watch only WATCHES and (with permission) emails a deep link.
 */
export default defineTool({
  description:
    "Set a Camp Watch so the user is alerted when a matching campsite opens up (cancellation alerting). Give campgroundIds (from cards) OR a parkCode (we'll watch its reservable campgrounds), plus startDate/endDate (YYYY-MM-DD) and optional siteType/hookups/ada/weekendOnly/minNights. Only call when the user asks to watch/monitor/get notified. It WATCHES only — it never books or holds a site.",
  inputSchema: z.object({
    campgroundIds: z.array(z.string()).optional(),
    parkCode: z.string().optional().describe('Watch the reservable campgrounds in/near this park'),
    startDate: z.string().describe('First night, YYYY-MM-DD'),
    endDate: z.string().describe('Last night, YYYY-MM-DD'),
    nights: z.number().optional(),
    minNights: z.number().optional(),
    siteType: z.enum(['tent', 'rv', 'group', 'any']).optional(),
    weekendOnly: z.boolean().optional(),
    hookups: z.enum(['none', '30amp', '50amp', 'full']).optional(),
    ada: z.boolean().optional(),
    label: z.string().optional().describe('A short name for the watch, e.g. "North Rim in October"'),
  }),
  async execute(args, ctx) {
    const userId = callerId(ctx);
    let campgroundIds = args.campgroundIds ?? [];
    if (!campgroundIds.length && args.parkCode) {
      const { items } = await searchCampgrounds({ nearParkCode: args.parkCode, reservable: true, hasRidb: true, limit: 12 });
      campgroundIds = items.map((c) => c.id);
    }
    if (!campgroundIds.length) {
      return { kind: 'camp_watch_card', data: { error: 'Give me at least one campground (or a park) with reservable sites to watch.' } };
    }
    const res = await createCampWatch(userId, {
      campgroundIds,
      recAreaId: null,
      startDate: args.startDate,
      endDate: args.endDate,
      nights: args.nights ?? null,
      minNights: args.minNights ?? null,
      siteType: args.siteType ?? null,
      weekendOnly: args.weekendOnly ?? false,
      hookups: args.hookups ?? null,
      ada: args.ada ?? false,
      label: args.label ?? null,
    });
    if ('error' in res) return { kind: 'camp_watch_card', data: { error: res.error } };
    return { kind: 'camp_watch_card', data: { watches: await listCampWatches(userId), justCreated: res.id } };
  },
});
