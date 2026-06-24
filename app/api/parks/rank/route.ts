import { getUserId } from '../../../../lib/session';
import { rankParks, resolveRankParams, type RankRequestBody, type SavedConstraints } from '../../../../lib/recommend';
import { getTravelConstraints } from '../../../../lib/bridges';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';

/**
 * Live constraint re-ranking endpoint (ADR-046) powering the /explore "Refine live" sliders. userId is
 * optional (anonymous = no preference scoring, still ranks by filters + crowd). Body values OVERRIDE the
 * user's saved travel constraints; `defaults` echoes the saved constraints so the panel can pre-fill.
 * The body→params merge + clamps live in the pure `resolveRankParams` (unit-tested in recommend.test).
 */
export const dynamic = 'force-dynamic';

const NO_CONSTRAINTS: SavedConstraints = { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] };

export async function POST(req: Request) {
  // Anonymous ranking endpoint (audit C6): an attacker-controlled Neo4j filter/rank per request. Cap
  // per IP (a Vercel WAF rule backstops it too). Keyed by IP since userId is optional here.
  const rl = await rateLimit(rlIp(clientIp(req), 'rank'), 30, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }
  const userId = await getUserId(req);
  const body = (await req.json().catch(() => ({}))) as RankRequestBody;
  const cons = userId ? await getTravelConstraints(userId).catch(() => NO_CONSTRAINTS) : NO_CONSTRAINTS;
  const { items, total } = await rankParks(resolveRankParams(body, cons, userId));

  return Response.json({
    items,
    total,
    defaults: {
      rvMaxLengthFt: cons.rvMaxLengthFt,
      wheelchairAccessible: cons.wheelchair,
      requiredAmenities: cons.requiredAmenities,
    },
  });
}
