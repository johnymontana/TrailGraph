import { getUserId } from '../../../../lib/session';
import { consideredParksGeo, collectedStampParksGeo } from '../../../../lib/memory-graph';
import { forYou } from '../../../../lib/recommend';
import { travelersAlsoLoved } from '../../../../lib/collective';
import { serverError } from '../../../../lib/http';

/**
 * "Your map" overlay (#6): the signed-in user's CONSIDERED parks, "For you" recommendations, collected
 * passport-stamp parks, and a privacy-safe "travelers like you also loved" set. Authenticated (per-user
 * memory) — anonymous callers get empty arrays (the overlay just renders nothing) rather than a 401.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ considered: [], forYou: [], stamps: [], collective: [] });
  try {
    // Each overlay is independent — a failure in one shouldn't 500 the whole map. Degrade to an empty
    // layer (the overlay just renders nothing) rather than rejecting the Promise.all.
    const [considered, stamps, rec, collective] = await Promise.all([
      consideredParksGeo(userId).catch(() => []),
      collectedStampParksGeo(userId).catch(() => []),
      forYou(userId, { limit: 12 }).then((r) => r.parks).catch(() => []),
      travelersAlsoLoved(userId, 8).catch(() => []),
    ]);
    const pin = (p: { parkCode: string; lat: number | null; lng: number | null }) => ({ parkCode: p.parkCode, lat: p.lat, lng: p.lng });
    return Response.json({
      considered,
      stamps,
      forYou: rec.filter((p) => p.lat != null && p.lng != null).map(pin),
      // travelersAlsoLoved is opt-in + anonymized counts only; keep the count for the heat weight.
      collective: collective
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({ parkCode: p.parkCode, lat: p.lat ?? null, lng: p.lng ?? null, travelers: p.travelers })),
    });
  } catch (err) {
    return serverError('map-mine', err);
  }
}
