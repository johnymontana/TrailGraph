import { test, expect } from '@playwright/test';

/**
 * Regression gate for the HTTP security headers (audit S1) and fail-closed cron auth (S2/S3). Runs
 * against the production build (playwright webServer), DISABLE_EVE so no agent/AI Gateway is needed.
 * E2E_TEST_MODE does NOT set CRON_SECRET, so the cron routes must 401 unauthenticated callers.
 */
test('security headers are present and X-Powered-By is gone', async ({ request }) => {
  const res = await request.get('/signin');
  const h = res.headers();
  // CSP ships Report-Only first; accept either key so flipping to enforce doesn't break this gate.
  const csp = h['content-security-policy-report-only'] ?? h['content-security-policy'];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("default-src 'self'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  expect(h['strict-transport-security']).toContain('includeSubDomains');
  expect(h['x-powered-by']).toBeUndefined();
});

test('cron routes fail closed without a valid bearer', async ({ request }) => {
  for (const path of ['/api/sync?tier=all', '/api/digests', '/api/memory/reconcile']) {
    const res = await request.get(path);
    expect(res.status(), `${path} should reject unauthenticated cron`).toBe(401);
  }
});
