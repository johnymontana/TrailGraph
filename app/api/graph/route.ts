import {
  searchParks,
  parksNear,
  parksInBBox,
  vibeSearch,
  campgroundsInBBox,
  visitorCentersInBBox,
  thingsToDoInBBox,
  alertParksInBBox,
  type BBox,
} from '../../../lib/queries';

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
          default:
            return Response.json({ parks: await parksInBBox(box) });
        }
      }
      case 'vibe': {
        const q = url.searchParams.get('q');
        if (!q) return Response.json({ error: 'q required' }, { status: 400 });
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
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
