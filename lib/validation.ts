import { z } from 'zod';

/**
 * Runtime body validation for POST/PATCH route handlers (audit S4/C9). The handlers previously cast
 * `await req.json()` with `as` — no runtime check, and `serverActions.bodySizeLimit` does NOT cover
 * route handlers, so an arbitrarily large array/string was a cheap CPU/memory amplifier. Every string
 * and array here carries a `.max()` bound, which is the amplification guard. zod is already a dep.
 *
 * parseBody strips unknown keys (zod default) and returns a 400 with field-level issues on failure, so
 * routes stay terse: `const p = await parseBody(req, Schema); if (!p.ok) return p.response;`.
 */

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return badRequest('invalid JSON body');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return badRequest('invalid request body', issues);
  }
  return { ok: true, data: result.data };
}

function badRequest(error: string, issues?: string[]): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error, issues }, { status: 400 }) };
}

// ── Shared field bounds ─────────────────────────────────────────────────────
const id = z.string().max(100);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const latLng = z.object({ latitude: lat, longitude: lng, label: z.string().max(200).optional() });

// ── Trips ───────────────────────────────────────────────────────────────────
const NewStopSchema = z.object({
  kind: z.enum(['park', 'campground', 'poi', 'place', 'custom']),
  refId: id.optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  name: z.string().max(300).optional(),
  day: z.number().int().min(0).max(366).optional(),
  nights: z.number().int().min(0).max(366).optional(),
});

export const CreateTripSchema = z.object({
  name: z.string().trim().max(200).optional(), // required only for the non-tour path (route checks)
  startDate: z.string().max(40).optional(),
  endDate: z.string().max(40).optional(),
  startPoint: latLng.optional(),
  endPoint: latLng.optional(),
  fromTourId: id.optional(),
});

export const TripActionSchema = z.object({
  op: z.enum([
    'addStop', 'removeStop', 'reorder', 'alerts', 'cost', 'conditions',
    'suggestDays', 'optimize', 'rename', 'fork', 'diff',
  ]),
  stop: NewStopSchema.optional(),
  stopId: id.optional(),
  orderedStopIds: z.array(id).max(200).optional(),
  name: z.string().max(200).optional(),
  otherTripId: id.optional(),
});

// ── Memory ───────────────────────────────────────────────────────────────────
export const MemoryActionSchema = z.object({
  op: z.enum([
    'deletePreference', 'deleteConsidered', 'clearConsidered', 'feedback', 'addPreference',
    'setWeight', 'setTravelConstraints', 'clearTravelConstraints', 'removeRequiredAmenity', 'recordPass', 'clearPass',
    'collectStamp', 'uncollectStamp', 'setAvailability', 'clearAvailability',
  ]),
  kind: z.enum(['activity', 'topic']).optional(),
  name: z.string().max(200).optional(),
  parkCode: z.string().max(20).optional(),
  vote: z.enum(['up', 'down']).optional(),
  category: z.string().max(100).optional(),
  value: z.string().max(500).optional(),
  weight: z.number().min(-100).max(100).optional(),
  wheelchair: z.boolean().optional(),
  rvMaxLengthFt: z.number().min(0).max(1000).nullable().optional(),
  requiredAmenities: z.array(z.string().max(100)).max(50).optional(),
  passId: id.optional(),
  stampId: id.optional(),
  start: z.string().max(40).nullable().optional(),
  end: z.string().max(40).nullable().optional(),
});

// ── Share ─────────────────────────────────────────────────────────────────────
// 'edit' role removed (S7) — only read-only links are honored.
export const ShareCreateSchema = z.object({ role: z.enum(['read']).optional() });
