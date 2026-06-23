import { getUserId } from '../../../../../lib/session';
import { getTrip } from '../../../../../lib/trips';
import { tripToIcs } from '../../../../../lib/trip-ics';
import { sunTimesFor } from '../../../../../lib/datasources';

/** ICS calendar export for a trip (C6). */
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

function stamps() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const baseDate = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const stamp = `${baseDate}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return { baseDate, stamp };
}

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) return Response.json({ error: 'not found' }, { status: 404 });

  // Bake the night's dark-sky facts into each event (ADR-048) via the deterministic astro datasource.
  const ics = tripToIcs(trip, { ...stamps(), sun: (la, ln, iso) => sunTimesFor(la, ln, iso) });
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${(trip.name ?? 'trip').replace(/[^a-z0-9]+/gi, '-')}.ics"`,
    },
  });
}
