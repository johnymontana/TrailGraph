import { unstable_cache } from 'next/cache';
import {
  searchParks,
  parksNear,
  parksInBBox,
  allParksGeo,
  vibeSearch,
  campgroundsInBBox,
  visitorCentersInBBox,
  thingsToDoInBBox,
  alertParksInBBox,
  trailheadsInBBox,
  parksWithConditionFacts,
  parkCodesByFacet,
  parkEdgesInBBox,
  journeyTrail,
  type BBox,
  type EdgeKind,
} from '../../../lib/queries';
import { nearestNeighborOrder } from '../../../lib/route-order';
import { parseOperatingHours, openStateOn } from '../../../lib/sync/hours';
import { getAstro } from '../../../lib/datasources/astro';
import { getWeather } from '../../../lib/datasources/weather';
import { isFeeFreeDay } from '../../../lib/datasources/feefree';
import { scoreMapCondition, clearSkyFromCondition, type ConditionFacts } from '../../../lib/conditions-map';
import { rateLimit, rlIp, clientIp } from '../../../lib/rate-limit';
import { serverError } from '../../../lib/http';

/** Cap the condition-aware fan-out (#4): each park does a runtime weather fetch + astro compute. */
const CONDITIONS_CAP = 40;

/**
 * The full park set is tiny (~hundreds) and changes only on a sync, so cache it server-side and let the
 * map load it once + cluster client-side (#12) instead of re-querying Neo4j on every pan. The route is
 * force-dynamic, so the data-layer unstable_cache (not RSC-level caching) is what actually skips Neo4j.
 */
// Bump the key suffix whenever allParksGeo's shape changes (v2 added the #3 lens scalars) so a deployed
// instance with a warm cache doesn't keep serving the old, narrower payload until revalidate.
const cachedAllParksGeo = unstable_cache(async () => allParksGeo(), ['map:parks-all-v2'], {
  revalidate: 3600,
  tags: ['parks'],
});

/**
 * Domain read BFF (AD-4). Client map/explore widgets call this; RSC pages call the lib directly.
 * Read-only, no auth required (domain data is public NPS content).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const op = url.searchParams.get('op') ?? 'search';
  const n = (k: string) => {
    const v = url.searchParams.get(k);
    return v == null ? undefined : Number(v);
  };

  try {
    switch (op) {
      case 'parks-all': {
        // Single cached load for the clustered map source (#12) — no bbox; client clusters.
        return Response.json(
          { parks: await cachedAllParksGeo() },
          { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
        );
      }
      case 'near': {
        const lat = n('lat');
        const lng = n('lng');
        if (lat == null || lng == null) return Response.json({ error: 'lat/lng required' }, { status: 400 });
        return Response.json({ parks: await parksNear(lat, lng, n('radiusMiles') ?? 150) });
      }
      case 'bbox': {
        const box: BBox = { minLat: n('minLat')!, minLng: n('minLng')!, maxLat: n('maxLat')!, maxLng: n('maxLng')! };
        if (Object.values(box).some((v) => Number.isNaN(v))) return Response.json({ error: 'bbox required' }, { status: 400 });
        // Layer toggles (B3); default = parks.
        switch (url.searchParams.get('layer')) {
          case 'campgrounds':
            return Response.json({ items: await campgroundsInBBox(box) });
          case 'visitorcenters':
            return Response.json({ items: await visitorCentersInBBox(box) });
          case 'thingstodo':
            return Response.json({ items: await thingsToDoInBBox(box) });
          case 'alerts':
            return Response.json({ items: await alertParksInBBox(box) });
          case 'trails':
            return Response.json({ items: await trailheadsInBBox(box) });
          default:
            return Response.json({ parks: await parksInBBox(box) });
        }
      }
      case 'connections': {
        // Park-to-park edges on the map (#5): a topic/person draws a thematic-trail PATH; otherwise the
        // materialized NEAR/SHARES edges within the viewport.
        const topic = url.searchParams.get('topic');
        const person = url.searchParams.get('person');
        if (topic || person) {
          const trail = await journeyTrail({ topic: topic ?? undefined, person: person ?? undefined }, 40);
          const located = trail.filter((p) => p.lat != null && p.lng != null);
          const ordered = nearestNeighborOrder(located.map((p) => ({ id: p.parkCode, lat: p.lat as number, lng: p.lng as number })));
          const byCode = new Map(located.map((p) => [p.parkCode, p]));
          const edges = [];
          for (let i = 0; i + 1 < ordered.length; i++) {
            const a = byCode.get(ordered[i]);
            const b = byCode.get(ordered[i + 1]);
            if (a && b) edges.push({ aCode: a.parkCode, aLat: a.lat, aLng: a.lng, bCode: b.parkCode, bLat: b.lat, bLng: b.lng, weight: 0 });
          }
          return Response.json({
            edges,
            theme: topic ?? person,
            parks: located.map((p) => ({ parkCode: p.parkCode, name: p.name, lat: p.lat, lng: p.lng })),
          });
        }
        const box: BBox = { minLat: n('minLat')!, minLng: n('minLng')!, maxLat: n('maxLat')!, maxLng: n('maxLng')! };
        if (Object.values(box).some((v) => Number.isNaN(v))) return Response.json({ error: 'bbox required' }, { status: 400 });
        const k = url.searchParams.get('kind');
        const kind: EdgeKind = k === 'topic' ? 'topic' : k === 'activity' ? 'activity' : 'near';
        return Response.json({ edges: await parkEdgesInBBox(box, kind) });
      }
      case 'facetcodes': {
        // All parkCodes matching state/activity/topic facets (#8b) — the map intersects them with its
        // loaded parks-all set. Cheap (codes only); no rate-limit needed.
        return Response.json({
          parkCodes: await parkCodesByFacet({
            stateCode: url.searchParams.get('stateCode') ?? undefined,
            activity: url.searchParams.get('activity') ?? undefined,
            topic: url.searchParams.get('topic') ?? undefined,
          }),
        });
      }
      case 'conditions': {
        // Condition-aware map (#4): score viewport parks for a date by open-state + alerts + crowd (graph)
        // + clear-sky (runtime weather) + new-moon (astro) + fee-free. Capped + IP-rate-limited because each
        // park does a live weather fetch + astro compute.
        const box: BBox = { minLat: n('minLat')!, minLng: n('minLng')!, maxLat: n('maxLat')!, maxLng: n('maxLng')! };
        if (Object.values(box).some((v) => Number.isNaN(v))) return Response.json({ error: 'bbox required' }, { status: 400 });
        const dateParam = url.searchParams.get('date');
        const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '') ? dateParam! : new Date().toISOString().slice(0, 10);
        const rl = await rateLimit(rlIp(clientIp(req), 'conditions'), 20, 60);
        if (!rl.ok) {
          return Response.json(
            { error: 'rate_limited' },
            { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
          );
        }
        const facts = (await parksWithConditionFacts(box)).slice(0, CONDITIONS_CAP);
        const feeFree = !!isFeeFreeDay(isoDate);
        // Forecast horizon: days from today to the target date (UTC end-to-end so the client-local isoDate
        // doesn't drift against server-local midnight). Open-Meteo caps at 16.
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const daysAhead = Math.min(16, Math.max(1, Math.round((new Date(`${isoDate}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000) + 1));
        // Moon illumination is ~global at a given date — compute once, not per park.
        const moonIlluminationPct = getAstro(0, 0, isoDate).moon.illuminationPct;
        const validCrowd = new Set(['low', 'moderate', 'high', 'very high']);
        const parks = await Promise.all(
          facts.map(async (f) => {
            const open = openStateOn(parseOperatingHours(f.hours, f.parkCode), isoDate);
            const weather = await getWeather(f.lat, f.lng, { days: daysAhead });
            // Match the target day by date, else the furthest daily row (= the requested horizon) so a
            // park/client timezone off-by-one doesn't silently drop the forecast.
            const day = weather?.daily.find((d) => d.date === isoDate) ?? weather?.daily.at(-1);
            const { category } = scoreMapCondition({
              open,
              alert: f.alert,
              clearSky: clearSkyFromCondition(day?.condition),
              moonIlluminationPct,
              crowdLevel: validCrowd.has(f.crowdLevel as string) ? (f.crowdLevel as ConditionFacts['crowdLevel']) : null,
              feeFree,
            });
            return { parkCode: f.parkCode, category };
          }),
        );
        return Response.json({ parks, date: isoDate, capped: facts.length >= CONDITIONS_CAP });
      }
      case 'vibe': {
        const q = url.searchParams.get('q');
        // op=vibe runs an AI-Gateway embedding per request and is anonymous (audit C5): guard input
        // and cap per IP. The cheap bbox/near/search ops stay unthrottled at the app layer (the map
        // fires them on every pan); a coarse Vercel WAF rule backstops the whole route.
        if (!q || q.trim().length < 3) return Response.json({ error: 'q required (min 3 chars)' }, { status: 400 });
        const rl = await rateLimit(rlIp(clientIp(req), 'vibe'), 20, 60);
        if (!rl.ok) {
          return Response.json(
            { error: 'rate_limited' },
            { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))) } },
          );
        }
        return Response.json({ parks: await vibeSearch(q) });
      }
      default: {
        const r = await searchParks({
          q: url.searchParams.get('q') ?? undefined,
          stateCode: url.searchParams.get('stateCode') ?? undefined,
          activity: url.searchParams.get('activity') ?? undefined,
          topic: url.searchParams.get('topic') ?? undefined,
          designation: url.searchParams.get('designation') ?? undefined,
          offset: n('offset'),
        });
        return Response.json({ parks: r.items, total: r.total });
      }
    }
  } catch (err) {
    return serverError('graph', err);
  }
}
