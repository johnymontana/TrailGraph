import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { searchCampgrounds } from '../../lib/campgrounds';
import { getCampPreferences } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Multi-agency campground finder (Campgrounds feature) — ONE traversal filters NPS/USFS/BLM/state/dispersed
 * campgrounds by agency, booking type, site type, hookups, RV length, accessibility, pets, amenities,
 * dark-sky, price, and proximity to a park (incl. cross-boundary NEAR sites). Prefer this over prose for a
 * structured ask ("quiet tent-only site near Yosemite under $30"). The user's saved `PREFERS_CAMP`
 * preferences are applied as DEFAULTS (explicit args win) unless `usePreferences:false`. userId-bound (R4).
 */
export default defineTool({
  description:
    "Find campgrounds (NPS/USFS/BLM/state/dispersed) by agency, booking (reservable/first-come/free), site type, hookups, min RV length, ADA, pets, dump station, dark-sky, max price, or near a park (incl. nearby forest/BLM sites). The structured graph search — use it for 'quiet tent site near Yosemite under $30'. Returns campground cards. Applies the user's saved camp preferences as defaults. Does NOT check live availability (use check_campsite_availability for that) and never books.",
  inputSchema: z.object({
    q: z.string().optional().describe('Free-text campground-name search'),
    nearParkCode: z.string().optional().describe('Park code — includes campgrounds IN the park and nearby (NEAR) forest/BLM sites'),
    agency: z.enum(['NPS', 'USFS', 'BLM', 'USACE', 'STATE']).optional(),
    reservable: z.boolean().optional(),
    fcfs: z.boolean().optional().describe('First-come, first-served'),
    free: z.boolean().optional(),
    dispersed: z.boolean().optional().describe('Free dispersed / overland camping'),
    siteType: z.enum(['tent', 'rv', 'group', 'cabin', 'walk-in', 'equestrian']).optional(),
    hookups: z.boolean().optional(),
    minAmps: z.number().optional().describe('Minimum electric hookup amps, e.g. 30 or 50'),
    maxRvLength: z.number().optional().describe('Min RV/trailer length the site must accept (ft)'),
    ada: z.boolean().optional(),
    pets: z.boolean().optional(),
    dumpStation: z.boolean().optional(),
    darkSky: z.boolean().optional(),
    maxPriceUSD: z.number().optional(),
    usePreferences: z.boolean().default(true).describe("Apply the user's saved camp preferences as defaults"),
    limit: z.number().min(1).max(24).default(8),
  }),
  async execute(args, ctx) {
    const userId = callerId(ctx);
    const prefs = args.usePreferences ? await getCampPreferences(userId) : null;

    // Saved prefs fill only the constraints the caller left unset — an explicit arg always wins.
    const applied: string[] = [];
    const maxRvLength = args.maxRvLength ?? prefs?.maxLengthFt ?? undefined;
    const hookups = args.hookups ?? (prefs?.hookups && prefs.hookups !== 'none' ? true : undefined);
    const ada = args.ada ?? (prefs?.ada ? true : undefined);
    const pets = args.pets ?? (prefs?.pets ? true : undefined);
    const siteType = args.siteType ?? (prefs?.rig === 'rv' ? 'rv' : prefs?.rig === 'tent' || prefs?.tentOk ? 'tent' : undefined);
    const maxPriceUSD = args.maxPriceUSD ?? prefs?.budget ?? undefined;
    if (prefs) {
      if (args.maxRvLength == null && prefs.maxLengthFt != null) applied.push(`fits a ${prefs.maxLengthFt}-ft rig`);
      if (args.hookups == null && prefs.hookups && prefs.hookups !== 'none') applied.push(prefs.hookups);
      if (args.ada == null && prefs.ada) applied.push('ADA');
      if (args.pets == null && prefs.pets) applied.push('pets ok');
      if (args.maxPriceUSD == null && prefs.budget != null) applied.push(`≤ $${prefs.budget}`);
    }

    const { items, total } = await searchCampgrounds({
      q: args.q,
      nearParkCode: args.nearParkCode,
      agency: args.agency,
      reservable: args.reservable,
      fcfs: args.fcfs,
      free: args.free,
      dispersed: args.dispersed,
      siteType,
      hookups,
      minAmps: args.minAmps,
      maxRvLength,
      ada,
      pets,
      dumpStation: args.dumpStation,
      darkSky: args.darkSky,
      maxPriceUSD,
      limit: args.limit,
    });
    return { kind: 'campground_card', data: { campgrounds: items, total, appliedPreferences: applied } };
  },
});
