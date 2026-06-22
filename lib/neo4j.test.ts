import { describe, it, expect } from 'vitest';
import { sanitizeParams } from './neo4j';

/**
 * Regression: neo4j-driver drops `undefined` params (→ "Expected parameter(s): $x") and can't bind a
 * raw JS Date. The Better Auth adapter passes both (optional fields; expired-verification cleanup
 * `WHERE expiresAt < <Date>`). sanitizeParams normalizes them at the driver boundary.
 */
describe('sanitizeParams', () => {
  it('converts top-level undefined to null', () => {
    expect(sanitizeParams({ w0: undefined })).toEqual({ w0: null });
  });

  it('converts Date to an ISO string (we store dates as ISO strings)', () => {
    const d = new Date('2026-06-21T00:00:00.000Z');
    expect((sanitizeParams({ expiresAt: d }) as Record<string, unknown>).expiresAt).toBe(
      '2026-06-21T00:00:00.000Z',
    );
  });

  it('recurses into arrays and plain-object maps', () => {
    expect(sanitizeParams({ props: { name: undefined, age: 3 }, tags: [undefined, 'a'] })).toEqual({
      props: { name: null, age: 3 },
      tags: [null, 'a'],
    });
  });

  it('leaves primitives and nulls intact', () => {
    expect(sanitizeParams({ a: 'x', b: 5, c: true, d: null })).toEqual({ a: 'x', b: 5, c: true, d: null });
  });
});
