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
  type NewStop,
} from '../../../../lib/trips';
import { suggestDays } from '../../../../lib/itinerary';
import { nearestNeighborOrder } from '../../../../lib/route-order';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ trip });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteTrip(userId, id);
  return Response.json({ ok: true });
}

/** Sub-actions on a trip: addStop | removeStop | reorder | alerts. */
export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as {
    op: 'addStop' | 'removeStop' | 'reorder' | 'alerts' | 'cost' | 'conditions' | 'suggestDays' | 'optimize' | 'rename';
    stop?: NewStop;
    stopId?: string;
    orderedStopIds?: string[];
    name?: string;
  };

  switch (body.op) {
    case 'rename': {
      const name = body.name?.trim();
      if (!name) return Response.json({ error: 'name required' }, { status: 400 });
      await renameTrip(userId, id, name);
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'addStop': {
      if (!body.stop) return Response.json({ error: 'stop required' }, { status: 400 });
      const stopId = await addStop(userId, id, body.stop);
      if (!stopId) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ stopId, trip: await getTrip(userId, id) });
    }
    case 'removeStop': {
      if (!body.stopId) return Response.json({ error: 'stopId required' }, { status: 400 });
      await removeStop(userId, id, body.stopId);
      return Response.json({ trip: await getTrip(userId, id) });
    }
    case 'reorder': {
      if (!body.orderedStopIds) return Response.json({ error: 'orderedStopIds required' }, { status: 400 });
      await reorderStops(userId, id, body.orderedStopIds);
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
      return Response.json({ trip: await getTrip(userId, id) });
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
