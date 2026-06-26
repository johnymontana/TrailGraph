import { test, expect } from '@playwright/test';

/**
 * Field-ready & offline map (#10): the printable field-sheet + offline-ZIP routes, and the "share this view"
 * deep-link restoring the panel state. The bbox covers the seeded NW parks (yell 44.6,-110.5 + glac 48.7,-113.8).
 * Routes take minLat/minLng/maxLat/maxLng (NOT a single `bbox` param).
 */
const BBOX = 'minLat=40&minLng=-116&maxLat=50&maxLng=-108';

test.describe('field-ready & offline map (#10)', () => {
  test('GET /api/map/field returns a printable HTML field sheet', async ({ request }) => {
    const res = await request.get(`/api/map/field?${BBOX}&layers=campgrounds`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('National parks in this area');
    expect(html).toMatch(/parks? in view/);
  });

  test('GET /api/map/offline returns a downloadable ZIP', async ({ request }) => {
    const res = await request.get(`/api/map/offline?${BBOX}&layers=campgrounds,visitorcenters`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/zip');
    expect(res.headers()['content-disposition']).toMatch(/attachment/);
    expect((await res.body()).byteLength).toBeGreaterThan(0);
  });

  test('a missing bbox is a 400 (not a bogus 0,0 box)', async ({ request }) => {
    const res = await request.get('/api/map/field');
    expect(res.status()).toBe(400);
  });

  test('share-this-view deep-link restores the panel (lens + #10 controls)', async ({ page }) => {
    await page.goto('/map?lens=crowd&layers=campgrounds,alerts&lat=44.6&lng=-110.5&z=8', { waitUntil: 'load' });
    // Full-screen map page tags its container (hides the global footer) + the map div is role=application.
    await expect(page.locator('[data-fullscreen]')).toBeVisible();
    await expect(page.getByRole('application')).toBeVisible();
    // Lens deep-link applied → the crowd legend renders (a "Very high" swatch is crowd-lens-specific).
    await expect(page.getByText('Very high')).toBeVisible();
    // The #10 "Field & offline" panel section + its share control render.
    await expect(page.getByText('Field & offline')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share this view' })).toBeVisible();
  });
});
