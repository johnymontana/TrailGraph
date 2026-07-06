import { z } from 'zod';
import { getUserId } from '../../../../lib/session';
import { routing } from '../../../../lib/routing';
import { setHomeLocation, getHomeLocation, clearHomeLocation } from '../../../../lib/bridges';
import { serverError } from '../../../../lib/http';

/**
 * Home location (user-feedback iteration): GET/PUT/DELETE the `(:User)-[:LIVES_AT]->(:Home)` anchor.
 * Geocoding stays server-side (the ORS key never reaches the client): PUT either a free-text `place`
 * (forward geocode) or browser-geolocation `latitude`/`longitude` (reverse geocode for the label).
 */
export const dynamic = 'force-dynamic';

const putSchema = z.union([
  z.object({ place: z.string().min(2).max(200) }),
  z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
]);

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ home: null });
  try {
    return Response.json({ home: await getHomeLocation(userId) });
  } catch (err) {
    return serverError('me-home', err);
  }
}

export async function PUT(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'Sign in to save a home location' }, { status: 401 });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Provide a place or coordinates' }, { status: 400 });
  try {
    if ('place' in parsed.data) {
      const hit = await routing.geocode(parsed.data.place);
      if (!hit) return Response.json({ error: `Couldn't find "${parsed.data.place}"` }, { status: 404 });
      await setHomeLocation(userId, { ...hit, source: 'geocode' });
    } else {
      const { latitude, longitude } = parsed.data;
      const label = (await routing.reverseGeocode({ latitude, longitude })) ?? 'My location';
      await setHomeLocation(userId, { latitude, longitude, label, source: 'geolocation' });
    }
    return Response.json({ home: await getHomeLocation(userId) });
  } catch (err) {
    return serverError('me-home', err);
  }
}

export async function DELETE(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    await clearHomeLocation(userId);
    return Response.json({ home: null });
  } catch (err) {
    return serverError('me-home', err);
  }
}
