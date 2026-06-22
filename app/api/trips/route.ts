import { getUserId } from '../../../lib/session';
import { listTrips, createTrip, createTripFromTour, type NewTrip } from '../../../lib/trips';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ trips: await listTrips(userId) });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json()) as NewTrip & { fromTourId?: string };
  // Seed from an official NPS tour (P1 #3) when `fromTourId` is supplied.
  if (body?.fromTourId) {
    const created = await createTripFromTour(userId, body.fromTourId);
    if (!created) return Response.json({ error: 'tour has no usable stops' }, { status: 400 });
    return Response.json({ id: created.tripId, name: created.name, stops: created.stops }, { status: 201 });
  }
  if (!body?.name) return Response.json({ error: 'name required' }, { status: 400 });
  const id = await createTrip(userId, body);
  return Response.json({ id }, { status: 201 });
}
