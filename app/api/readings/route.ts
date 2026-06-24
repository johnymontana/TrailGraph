import { getUserId } from '../../../lib/session';
import { submitReading, myReadings } from '../../../lib/readings';

/**
 * Community sky-darkness readings (Collective Intelligence v2, ADR-053). POST submits the caller's SQM
 * reading for a park (validated, opt-in feeds the leaderboard); GET lists the caller's own readings.
 * userId server-bound (R4).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ readings: await myReadings(userId) });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json()) as { parkCode?: string; sqm?: number; takenAt?: string; lat?: number; lng?: number };
  if (!body.parkCode || typeof body.sqm !== 'number') {
    return Response.json({ error: 'parkCode and sqm are required' }, { status: 400 });
  }
  const result = await submitReading(userId, body.parkCode, body.sqm, body.takenAt, body.lat, body.lng);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true, id: result.id });
}
