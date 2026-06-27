import { getUserId } from '../../../../../lib/session';
import { getTrip, tripHikeRefs } from '../../../../../lib/trips';
import { tripToGpx } from '../../../../../lib/trip-gpx';
import { tripHikeTracks } from '../../../../../lib/trail-tracks';

/** GPX export for a trip (ADR-048) — waypoints + a connector track for Gaia/CalTopo/etc. */
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) return Response.json({ error: 'not found' }, { status: 404 });

  // Real trail polylines for any hikes attached to the trip's stops (ADR-071) — geometry from Blob.
  const refs = await tripHikeRefs(userId, id);
  const hikeTracks = refs.length ? await tripHikeTracks(refs) : [];
  const gpx = tripToGpx(trip, { time: new Date().toISOString(), hikeTracks });
  return new Response(gpx, {
    headers: {
      'content-type': 'application/gpx+xml; charset=utf-8',
      'content-disposition': `attachment; filename="${(trip.name ?? 'trip').replace(/[^a-z0-9]+/gi, '-')}.gpx"`,
    },
  });
}
