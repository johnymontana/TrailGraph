import { areaBrief, parseAreaBox, parseAreaLayers } from '../../../../lib/area-pack';
import { areaFieldHtml } from '../../../../lib/area-field-html';
import { rateLimit, rlIp, clientIp } from '../../../../lib/rate-limit';

/**
 * Printable field sheet for the current map viewport (#10): the same area brief as the offline pack, rendered
 * as standalone HTML the user can print or save. Opens in a new tab from the map panel. IP-rate-limited.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const rl = await rateLimit(rlIp(clientIp(req), 'map-field'), 10, 60);
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
  return new Response(areaFieldHtml(brief), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
