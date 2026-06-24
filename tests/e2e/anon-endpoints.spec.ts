import { test, expect } from '@playwright/test';

/**
 * Guards on the anonymous compute endpoints (audit C5/C6): input validation, per-IP rate limiting, and
 * auth on the usage endpoint. Runs against the production build (DISABLE_EVE). The rate-limit buckets
 * live in the seeded Neo4j. Embeddings aren't reachable in e2e (no AI Gateway key), but the rate-limit
 * + input checks run BEFORE any embedding, so these assertions don't depend on embeddings working.
 */

test('vibe search rejects too-short queries before doing any work', async ({ request }) => {
  const res = await request.get('/api/graph?op=vibe&q=ab'); // < 3 chars
  expect(res.status()).toBe(400);
});

test('vibe search is rate-limited per IP (429 within a burst)', async ({ request }) => {
  let saw429 = false;
  for (let i = 0; i < 30; i++) {
    const res = await request.get('/api/graph?op=vibe&q=darkskies');
    if (res.status() === 429) {
      expect(res.headers()['retry-after']).toBeDefined();
      saw429 = true;
      break;
    }
  }
  expect(saw429, 'expected a 429 after exceeding the per-IP vibe limit').toBe(true);
});

test('parks rank is rate-limited per IP (429 within a burst)', async ({ request }) => {
  let saw429 = false;
  for (let i = 0; i < 45; i++) {
    const res = await request.post('/api/parks/rank', { data: {} });
    if (res.status() === 429) {
      saw429 = true;
      break;
    }
  }
  expect(saw429, 'expected a 429 after exceeding the per-IP rank limit').toBe(true);
});

test('usage endpoint requires authentication', async ({ request }) => {
  const res = await request.get('/api/usage');
  expect(res.status()).toBe(401);
});

test('a bogus share token resolves to 404', async ({ request }) => {
  const res = await request.get('/api/shared/deadbeefdeadbeefdeadbeefdeadbeef');
  expect(res.status()).toBe(404);
});
