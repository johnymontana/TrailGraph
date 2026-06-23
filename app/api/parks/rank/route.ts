import { getUserId } from '../../../../lib/session';
import { rankParks } from '../../../../lib/recommend';
import { getTravelConstraints } from '../../../../lib/bridges';

/**
 * Live constraint re-ranking endpoint (ADR-046) powering the /explore "Refine live" sliders. userId is
 * optional (anonymous = no preference scoring, still ranks by filters + crowd). Body values OVERRIDE the
 * user's saved travel constraints; `defaults` echoes the saved constraints so the panel can pre-fill.
 */
export const dynamic = 'force-dynamic';

function clamp(n: unknown, lo: number, hi: number): number | undefined {
  if (typeof n !== 'number' || Number.isNaN(n)) return undefined;
  return Math.min(hi, Math.max(lo, n));
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  const body = await req.json().catch(() => ({})) as {
    maxBortle?: number;
    minBortle?: number; // alias — lower Bortle = darker; mapped to maxBortle
    crowdTolerance?: number;
    requiredAmenities?: string[];
    rvMaxLengthFt?: number | null;
    wheelchairAccessible?: boolean;
    stateCode?: string;
    activity?: string;
    topic?: string;
    limit?: number;
    offset?: number;
  };

  const cons = userId
    ? await getTravelConstraints(userId).catch(() => ({ wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] }))
    : { wheelchair: false, rvMaxLengthFt: null, requiredAmenities: [] };

  // Body overrides saved constraints when present.
  const rvRaw = body.rvMaxLengthFt !== undefined ? body.rvMaxLengthFt : cons.rvMaxLengthFt;
  const { items, total } = await rankParks({
    userId,
    stateCode: body.stateCode,
    activity: body.activity,
    topic: body.topic,
    rvMaxLengthFt: rvRaw && rvRaw > 0 ? rvRaw : null,
    wheelchairAccessible: body.wheelchairAccessible ?? cons.wheelchair,
    requiredAmenities: body.requiredAmenities ?? cons.requiredAmenities,
    maxBortle: clamp(body.maxBortle ?? body.minBortle, 1, 9) ?? null,
    crowdTolerance: clamp(body.crowdTolerance, 0, 1) ?? null,
    limit: clamp(body.limit, 1, 48) ?? 24,
    offset: clamp(body.offset, 0, 100_000) ?? 0,
  });

  return Response.json({
    items,
    total,
    defaults: {
      rvMaxLengthFt: cons.rvMaxLengthFt,
      wheelchairAccessible: cons.wheelchair,
      requiredAmenities: cons.requiredAmenities,
    },
  });
}
