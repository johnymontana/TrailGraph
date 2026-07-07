import { getUserId } from '../../../../lib/session';
import {
  getTrip,
  deleteTrip,
  addStop,
  removeStop,
  reorderStops,
  renameTrip,
  checkTripAlerts,
  tripCost,
  tripConditions,
  addTrailToStop,
  removeTrailFromStop,
  addLodgingToStop,
  removeCampgroundFromStop,
} from '../../../../lib/trips';
import { setTripOrigin } from '../../../../lib/trips';
import { routing } from '../../../../lib/routing';
import { suggestDays } from '../../../../lib/itinerary';
import { nearestNeighborOrder } from '../../../../lib/route-order';
import { forkTrip, tripDiff, tripMetrics } from '../../../../lib/trip-lab';
import { parseBody, TripActionSchema } from '../../../../lib/validation';
import { rateLimit, rlUser } from '../../../../lib/rate-limit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// Live running-total for the build-on-map canvas (#9): the aggregate metrics (drive miles/min, cost, dark
// hours) after a mutation. skipAlerts avoids the one external NPS call, so it stays cheap on every edit.
async function liveMetrics(userId: string, id: string) {
  try {
    return await tripMetrics(userId, id, { skipAlerts: true });
  } catch {
    return null; // metrics are a nice-to-have badge — never fail a mutation over them
  }
}

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) return Response.json({ error: 'not found' }, { status: 404 });
  // The canvas frames its initial badge with ?include=metrics, avoiding a second round-trip on open (#9).
  const wantMetrics = new URL(req.url).searchParams.get('include') === 'metrics';
  return Response.json({ trip, ...(wantMetrics ? { metrics: await liveMetrics(userId, id) } : {}) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteTrip(userId, id);
  return Response.json({ ok: true });
}

/** Ops that never touch ORS routing: pure reads over the trip + external NPS/weather lookups. They get
 * their own roomier budget (ADR-076) — the plan shell's cross-pane refresh multiplies read traffic
 * (every trip open auto-fires an `alerts` POST), and reads must never eat the edit budget. */
const READ_OPS = new Set(['alerts', 'cost', 'conditions', 'suggestDays', 'diff']);

/** Sub-actions on a trip: addStop | removeStop | reorder | alerts. */
export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const parsed = await parseBody(req, TripActionSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  // Two per-user budgets (ADR-076): `tripmut` caps the ops that fire ORS routing via recomputeSegments
  // (audit C7 — an unthrottled edit loop would burn the tight ORS free tier); `tripread` caps the
  // read-only checks (NPS/weather cost) without letting them starve real edits.
  const scope = READ_OPS.has(body.op) ? 'tripread' : 'tripmut';
  const rl = await rateLimit(rlUser(userId, scope), scope === 'tripread' ? 60 : 30, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }

  switch (body.op) {
    case 'fork': {
      const newId = await forkTrip(userId, id, body.name);
      if (!newId) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ tripId: newId, trip: await getTrip(userId, newId) });
    }
    case 'diff': {
      if (!body.otherTripId) return Response.json({ error: 'otherTripId required' }, { status: 400 });
      const diff = await tripDiff(userId, id, body.otherTripId);
      if (!diff) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ diff });
    }
    case 'rename': {
      const name = body.name?.trim();
      if (!name) return Response.json({ error: 'name required' }, { status: 400 });
      await renameTrip(userId, id, name);
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'setOrigin': {
      // Three forms: free-text place (geocoded server-side, ORS key stays private), explicit coords
      // (browser geolocation), or clearOrigin; returnToOrigin can ride along with any of them.
      let origin: { latitude: number; longitude: number; label?: string } | null | undefined;
      if (body.clearOrigin) origin = null;
      else if (body.origin) origin = body.origin;
      else if (body.place?.trim()) {
        const hit = await routing.geocode(body.place.trim());
        if (!hit) return Response.json({ error: `Couldn't find "${body.place.trim()}"` }, { status: 404 });
        origin = hit;
      }
      if (origin === undefined && body.returnToOrigin === undefined) {
        return Response.json({ error: 'place, origin, clearOrigin, or returnToOrigin required' }, { status: 400 });
      }
      const ok = await setTripOrigin(userId, id, { origin, returnToOrigin: body.returnToOrigin });
      if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ trip: await getTrip(userId, id), metrics: await liveMetrics(userId, id) });
    }
    case 'addStop': {
      if (!body.stop) return Response.json({ error: 'stop required' }, { status: 400 });
      const stopId = await addStop(userId, id, body.stop);
      if (!stopId) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ stopId, trip: await getTrip(userId, id), metrics: await liveMetrics(userId, id) });
    }
    case 'removeStop': {
      if (!body.stopId) return Response.json({ error: 'stopId required' }, { status: 400 });
      await removeStop(userId, id, body.stopId);
      return Response.json({ trip: await getTrip(userId, id), metrics: await liveMetrics(userId, id) });
    }
    case 'reorder': {
      if (!body.orderedStopIds) return Response.json({ error: 'orderedStopIds required' }, { status: 400 });
      await reorderStops(userId, id, body.orderedStopIds);
      return Response.json({ trip: await getTrip(userId, id), metrics: await liveMetrics(userId, id) });
    }
    case 'includeTrail': {
      if (!body.stopId || !body.trailId) return Response.json({ error: 'stopId and trailId required' }, { status: 400 });
      const ok = await addTrailToStop(userId, id, body.stopId, body.trailId);
      if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'excludeTrail': {
      if (!body.stopId || !body.trailId) return Response.json({ error: 'stopId and trailId required' }, { status: 400 });
      await removeTrailFromStop(userId, id, body.stopId, body.trailId);
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'includeCampground': {
      if (!body.stopId || !body.campgroundId) return Response.json({ error: 'stopId and campgroundId required' }, { status: 400 });
      const ok = await addLodgingToStop(userId, id, body.stopId, body.campgroundId, { date: body.date, nights: body.nights });
      if (!ok) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'excludeCampground': {
      if (!body.stopId || !body.campgroundId) return Response.json({ error: 'stopId and campgroundId required' }, { status: 400 });
      await removeCampgroundFromStop(userId, id, body.stopId, body.campgroundId);
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'alerts':
      return Response.json({ alerts: await checkTripAlerts(userId, id) });
    case 'cost':
      return Response.json({ cost: await tripCost(userId, id) });
    case 'conditions':
      return Response.json({ dashboard: await tripConditions(userId, id) });
    case 'optimize': {
      const trip = await getTrip(userId, id);
      if (!trip) return Response.json({ error: 'not found' }, { status: 404 });
      const stops = ((trip.stops ?? []).filter(Boolean) as { id: string; lat: number | null; lng: number | null }[])
        .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng }));
      await reorderStops(userId, id, nearestNeighborOrder(stops));
      return Response.json({ trip: await getTrip(userId, id), metrics: await liveMetrics(userId, id) });
    }
    case 'suggestDays': {
      const trip = await getTrip(userId, id);
      if (!trip) return Response.json({ error: 'not found' }, { status: 404 });
      const stops = ((trip.stops ?? []).filter(Boolean) as {
        id: string;
        driveTo?: { minutes: number } | null;
      }[]).map((s) => ({ id: s.id, driveMinutesToHere: s.driveTo?.minutes ?? 0 }));
      return Response.json({ days: suggestDays(stops) });
    }
    default:
      return Response.json({ error: 'unknown op' }, { status: 400 });
  }
}
