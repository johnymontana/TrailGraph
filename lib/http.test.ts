import { describe, it, expect, vi } from 'vitest';
import { serverError } from './http';

describe('serverError (S8 scrub)', () => {
  it('returns a generic 500 that does not leak the error message, merges extra fields', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = serverError('test', new Error('neo4j internal boom'), { tier: 'slow' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; tier?: string };
    expect(body.error).toBe('Internal server error');
    expect(body.tier).toBe('slow');
    expect(JSON.stringify(body)).not.toContain('boom');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
