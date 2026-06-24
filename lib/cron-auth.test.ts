import { describe, it, expect, afterEach } from 'vitest';
import { assertCron } from './cron-auth';

function reqWith(auth?: string): Request {
  return new Request('https://x/api/sync', auth ? { headers: { authorization: auth } } : undefined);
}

describe('assertCron (fail-closed cron auth, S2/S3)', () => {
  const prev = process.env.CRON_SECRET;
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it('fails CLOSED when CRON_SECRET is unset (even with a bearer)', () => {
    delete process.env.CRON_SECRET;
    expect(assertCron(reqWith('Bearer anything'))?.status).toBe(401);
  });

  it('401s a missing, wrong, or length-mismatched bearer', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    expect(assertCron(reqWith())?.status).toBe(401);
    expect(assertCron(reqWith('Bearer nope'))?.status).toBe(401);
    expect(assertCron(reqWith('Bearer super-secret-valu'))?.status).toBe(401); // 1 char short
  });

  it('authorizes the exact bearer (returns null)', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    expect(assertCron(reqWith('Bearer super-secret-value'))).toBeNull();
  });
});
