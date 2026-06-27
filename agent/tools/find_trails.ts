import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { searchTrails } from '../../lib/queries';
import { getTrailPreferences } from '../../lib/bridges';
import { callerId } from '../../lib/agent-ctx';

/**
 * Multi-constraint trail finder (ADR-066/071) — the graph-over-vector payoff: ONE traversal filters real
 * hikeable trails by length, elevation gain, difficulty, route type, allowed use, dog-friendly,
 * accessibility, permit, surface, supported activity, or scenery topic. Prefer this over prose for a
 * structured ask ("easy dog-friendly hike under 3 miles with a waterfall"). The user's saved
 * `PREFERS_TRAIL` preferences are applied as DEFAULTS (explicit args win) unless `usePreferences:false`.
 * userId is server-bound (R4).
 */
export default defineTool({
  description:
    "Find real hikeable trails by length, elevation gain, difficulty, route type, allowed use, dog-friendly, wheelchair-accessible, permit, surface, supported activity, or scenery topic. The structured graph search — use it for 'easy dog-friendly hike under 3 miles with a waterfall'. Returns trail cards. Applies the user's saved trail preferences as defaults.",
  inputSchema: z.object({
    q: z.string().optional().describe('Free-text trail-name search'),
    parkCode: z.string().optional(),
    region: z.string().optional(),
    difficulty: z.enum(['easy', 'moderate', 'strenuous']).optional(),
    minMiles: z.number().optional(),
    maxMiles: z.number().optional(),
    maxGainFt: z.number().optional(),
    routeType: z.enum(['loop', 'out-and-back', 'point-to-point', 'network']).optional(),
    allowedUse: z.string().optional().describe("e.g. 'hike', 'bike', 'horse', 'ada'"),
    dogsAllowed: z.boolean().optional(),
    wheelchairAccessible: z.boolean().optional(),
    permitRequired: z.boolean().optional(),
    surface: z.string().optional(),
    activity: z.string().optional().describe('Exact NPS Activity name the trail supports'),
    topic: z.string().optional().describe('Scenery topic, e.g. waterfalls / alpine lakes / summit views'),
    usePreferences: z.boolean().default(true).describe("Apply the user's saved trail preferences as defaults"),
    limit: z.number().min(1).max(24).default(8),
  }),
  async execute(args, ctx) {
    const userId = callerId(ctx);
    const prefs = args.usePreferences ? await getTrailPreferences(userId) : null;

    // Saved prefs fill only the constraints the caller left unset — an explicit arg always wins. The
    // `appliedPreferences` strings make the narrowing legible in the card (mirrors find_parks narrowedBy).
    // An explicit `difficulty` is an EXACT pick; the SAVED difficulty preference is a CEILING ("or easier"),
    // so it goes to `maxDifficulty` — keeping the "or easier" label honest (the bug the verifier caught).
    const applied: string[] = [];
    const difficulty = args.difficulty ?? undefined;
    const maxDifficulty = args.difficulty == null ? prefs?.difficulty ?? undefined : undefined;
    const maxMiles = args.maxMiles ?? prefs?.maxMiles ?? undefined;
    const maxGainFt = args.maxGainFt ?? prefs?.maxGainFt ?? undefined;
    const dogsAllowed = args.dogsAllowed ?? (prefs?.dogsRequired ? true : undefined);
    if (prefs) {
      if (args.difficulty == null && prefs.difficulty) applied.push(`${prefs.difficulty} or easier`);
      if (args.maxMiles == null && prefs.maxMiles != null) applied.push(`≤ ${prefs.maxMiles} mi`);
      if (args.maxGainFt == null && prefs.maxGainFt != null) applied.push(`≤ ${prefs.maxGainFt} ft gain`);
      if (args.dogsAllowed == null && prefs.dogsRequired) applied.push('dog-friendly');
    }

    const { items, total } = await searchTrails({
      q: args.q,
      parkCode: args.parkCode,
      region: args.region,
      difficulty,
      maxDifficulty,
      minMiles: args.minMiles,
      maxMiles,
      maxGainFt,
      routeType: args.routeType,
      allowedUse: args.allowedUse,
      dogsAllowed,
      wheelchairAccessible: args.wheelchairAccessible,
      permitRequired: args.permitRequired,
      surface: args.surface,
      activity: args.activity,
      topic: args.topic,
      limit: args.limit,
    });
    return { kind: 'trail_card', data: { trails: items, total, appliedPreferences: applied } };
  },
});
