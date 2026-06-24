import JSZip from 'jszip';
import { getUserId } from '../../../../../lib/session';
import { tripBrief } from '../../../../../lib/trip-lab';
import { tripBriefHtml } from '../../../../../lib/trip-brief-html';
import { fetchParkBoundary } from '../../../../../lib/parkboundary';

/**
 * Offline pack for a trip (ADR-057) — a zip for no-signal parks: the printable brief, the structured
 * brief JSON, a POIs file (coordinates + campgrounds + visitor centers per stop), and each park's
 * boundary GeoJSON (via the shared cached fetch). Complements the GPX/ICS exports (ADR-048).
 */
export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const brief = await tripBrief(userId, id);
  if (!brief) return Response.json({ error: 'not found' }, { status: 404 });

  const zip = new JSZip();
  zip.file('brief.html', tripBriefHtml(brief));
  zip.file('trip.json', JSON.stringify(brief, null, 2));

  // POIs: the navigable points per stop (coordinates + campgrounds + visitor centers).
  const pois = brief.stops.map((s) => ({
    name: s.name,
    parkCode: s.parkCode,
    lat: s.lat,
    lng: s.lng,
    visitorCenters: s.visitorCenters,
    campgrounds: s.campgrounds,
  }));
  zip.file('pois.json', JSON.stringify(pois, null, 2));

  // Boundary GeoJSON for each distinct park (best-effort; empty FeatureCollection when unavailable).
  const parkCodes = [...new Set(brief.stops.map((s) => s.parkCode).filter((c): c is string => !!c))];
  const boundaries = await Promise.all(parkCodes.map((c) => fetchParkBoundary(c)));
  parkCodes.forEach((c, i) => zip.file(`boundaries/${c}.geojson`, JSON.stringify(boundaries[i])));

  const blob = await zip.generateAsync({ type: 'arraybuffer' });
  const filename = `${(brief.name ?? 'trip').replace(/[^a-z0-9]+/gi, '-')}-offline.zip`;
  return new Response(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
