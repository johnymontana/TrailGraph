import { describe, it, expect } from 'vitest';
import {
  parseBody,
  CreateTripSchema,
  TripActionSchema,
  MemoryActionSchema,
  ShareCreateSchema,
} from './validation';

const post = (body: unknown) =>
  new Request('https://x/api', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('parseBody', () => {
  it('rejects invalid JSON with a 400', async () => {
    const r = await parseBody(post('not json{'), CreateTripSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      expect(await r.response.json()).toMatchObject({ error: 'invalid JSON body' });
    }
  });

  it('rejects a schema violation with 400 + field-level issues', async () => {
    const r = await parseBody(post({ op: 'nope' }), TripActionSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const body = (await r.response.json()) as { error: string; issues: string[] };
      expect(body.error).toBe('invalid request body');
      expect(Array.isArray(body.issues)).toBe(true);
      expect(body.issues.join(' ')).toContain('op');
    }
  });

  it('returns typed data and strips unknown keys on success', async () => {
    const r = await parseBody(post({ name: 'Trip', evil: 'x', startPoint: { latitude: 1, longitude: 2 } }), CreateTripSchema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.name).toBe('Trip');
      expect((r.data as Record<string, unknown>).evil).toBeUndefined(); // stripped
      expect(r.data.startPoint).toEqual({ latitude: 1, longitude: 2 });
    }
  });
});

describe('CreateTripSchema', () => {
  it('accepts a name-only trip and a tour-seed (no name)', () => {
    expect(CreateTripSchema.safeParse({ name: 'Utah' }).success).toBe(true);
    expect(CreateTripSchema.safeParse({ fromTourId: 'tour-1' }).success).toBe(true);
  });

  it('bounds the name and validates coordinates', () => {
    expect(CreateTripSchema.safeParse({ name: 'a'.repeat(201) }).success).toBe(false);
    expect(CreateTripSchema.safeParse({ name: 'x', startPoint: { latitude: 100, longitude: 0 } }).success).toBe(false);
    expect(CreateTripSchema.safeParse({ name: 'x', endPoint: { latitude: 0, longitude: 500 } }).success).toBe(false);
  });
});

describe('TripActionSchema', () => {
  it('accepts known ops with their payloads', () => {
    expect(TripActionSchema.safeParse({ op: 'addStop', stop: { kind: 'park', refId: 'yell' } }).success).toBe(true);
    expect(TripActionSchema.safeParse({ op: 'reorder', orderedStopIds: ['a', 'b'] }).success).toBe(true);
    expect(TripActionSchema.safeParse({ op: 'rename', name: 'New' }).success).toBe(true);
  });

  it('rejects unknown ops, oversize arrays, and bad stop kinds', () => {
    expect(TripActionSchema.safeParse({ op: 'dropDatabase' }).success).toBe(false);
    expect(TripActionSchema.safeParse({ op: 'reorder', orderedStopIds: Array(201).fill('x') }).success).toBe(false);
    expect(TripActionSchema.safeParse({ op: 'addStop', stop: { kind: 'spaceship' } }).success).toBe(false);
  });

  it('accepts every setOrigin form and bounds its payloads (ADR-074)', () => {
    expect(TripActionSchema.safeParse({ op: 'setOrigin', place: 'Bozeman, MT' }).success).toBe(true);
    expect(TripActionSchema.safeParse({ op: 'setOrigin', origin: { latitude: 45.6, longitude: -111, label: 'Bozeman' } }).success).toBe(true);
    expect(TripActionSchema.safeParse({ op: 'setOrigin', clearOrigin: true }).success).toBe(true);
    expect(TripActionSchema.safeParse({ op: 'setOrigin', returnToOrigin: false }).success).toBe(true);
    // Bounds: place length, coordinate ranges.
    expect(TripActionSchema.safeParse({ op: 'setOrigin', place: 'x'.repeat(201) }).success).toBe(false);
    expect(TripActionSchema.safeParse({ op: 'setOrigin', origin: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(TripActionSchema.safeParse({ op: 'setOrigin', origin: { latitude: 0, longitude: 181 } }).success).toBe(false);
  });
});

describe('MemoryActionSchema', () => {
  it('accepts valid actions', () => {
    expect(MemoryActionSchema.safeParse({ op: 'addPreference', category: 'activity', value: 'hiking' }).success).toBe(true);
    expect(MemoryActionSchema.safeParse({ op: 'setTravelConstraints', wheelchair: true, requiredAmenities: ['Restrooms'] }).success).toBe(true);
    // P0.5: per-row removal of a single durable accessibility/amenity need.
    expect(MemoryActionSchema.safeParse({ op: 'removeRequiredAmenity', name: 'Audio Description' }).success).toBe(true);
  });

  it('bounds arrays + numeric ranges and rejects unknown ops', () => {
    expect(MemoryActionSchema.safeParse({ op: 'setTravelConstraints', requiredAmenities: Array(51).fill('x') }).success).toBe(false);
    expect(MemoryActionSchema.safeParse({ op: 'setWeight', kind: 'activity', name: 'Hiking', weight: 9999 }).success).toBe(false);
    expect(MemoryActionSchema.safeParse({ op: 'rm -rf' }).success).toBe(false);
  });
});

describe('ShareCreateSchema (S7 — edit role removed)', () => {
  it('accepts read-only or empty, rejects edit', () => {
    expect(ShareCreateSchema.safeParse({ role: 'read' }).success).toBe(true);
    expect(ShareCreateSchema.safeParse({}).success).toBe(true);
    expect(ShareCreateSchema.safeParse({ role: 'edit' }).success).toBe(false);
  });
});
