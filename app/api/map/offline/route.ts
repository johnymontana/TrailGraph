import JSZip from 'jszip';
import { areaBrief, areaParksGeoJSON, areaPoisGeoJSON, parseAreaBox, parseAreaLayers } from '../../../../lib/area-pack';
import { areaFieldHtml } from '../../../../lib/area-field-html';
import { trailGeoUrlsForParks } from '../../../../lib/queries';
import { readParkTrails } from '../../../../lib/blob-trails';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';

/**
 * Offline area pack (#10): a ZIP of the current map viewport — a printable field sheet, parks + POIs GeoJSON,
 * per-park boundary GeoJSON, and an area manifest — for going offline in the field. Public (no per-user data)
 * but IP-rate-limited: each call runs bbox queries + fans out to NPS for boundaries.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const rl = await rateLimit(rlIp(clientIp(req), 'map-offline'), 5, 60);
  if (!rl.ok) {
    return Response.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
    );
  }
  const url = new URL(req.url);
  const box = parseAreaBox(url);
  if (!box) return Response.json({ error: 'bbox required: minLat, minLng, maxLat, maxLng' }, { status: 400 });

  const brief = await areaBrief(box, parseAreaLayers(url));
  const zip = new JSZip();
  zip.file('field-sheet.html', areaFieldHtml(brief));
  zip.file('parks.geojson', JSON.stringify(areaParksGeoJSON(brief), null, 2));
  zip.file('pois.geojson', JSON.stringify(areaPoisGeoJSON(brief), null, 2));
  zip.file('area.json', JSON.stringify({ box: brief.box, layers: brief.layers, capped: brief.capped, parks: brief.parks.length, pois: brief.pois.length }, null, 2));
  for (const b of brief.boundaries) zip.file(`boundaries/${b.parkCode}.geojson`, JSON.stringify(b.geojson));

  // Trail geometry per park (ADR-071) — only when the trails layer is on. Each park's FeatureCollection
  // carries the trail lines AND the embedded elevation profiles, so offline hikers get both. Geometry is
  // read from Blob (`:Park.trailsGeoUrl`); parks without synced trails are simply absent.
  if (brief.layers.includes('trails')) {
    const codes = brief.parks.map((p) => p.parkCode).filter((c): c is string => !!c);
    const urls = await trailGeoUrlsForParks(codes);
    const fcs = await Promise.all(
      urls.map(async ({ parkCode, geoUrl }) => ({ parkCode, fc: await readParkTrails(parkCode, geoUrl) })),
    );
    for (const { parkCode, fc } of fcs) {
      if (fc) zip.file(`trails/${parkCode}.geojson`, JSON.stringify(fc));
    }
  }

  const blob = await zip.generateAsync({ type: 'arraybuffer' });
  return new Response(blob, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="trailgraph-area-offline.zip"',
    },
  });
}
