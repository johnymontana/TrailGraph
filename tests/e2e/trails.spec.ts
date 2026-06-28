import { test, expect } from '@playwright/test';

/**
 * Real-trails finder + detail (ADR-066/070). Uses the seeded :Trail fixtures (grca: Bright Angel + South
 * Kaibab; yell: Storm Point; glac: Avalanche Lake + Highline; zion: Angels Landing [permit]). Geometry is
 * NOT synced in e2e (no Blob), so the detail route map + elevation profile show their degradation notes —
 * the metadata + structure are what we assert.
 */
test('trails finder renders the filter form + seeded trail cards', async ({ page }) => {
  await page.goto('/trails');
  await expect(page.getByRole('heading', { name: 'Find your hike' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  // Longest-first → Highline (11.8 mi) leads; Bright Angel is also present.
  await expect(page.getByText('Highline Trail')).toBeVisible();
  await expect(page.getByText('Bright Angel Trail')).toBeVisible();
});

test('trails finder filters by difficulty', async ({ page }) => {
  await page.goto('/trails?difficulty=easy');
  await expect(page.getByText('Storm Point Trail')).toBeVisible(); // the only easy trail
  await expect(page.getByText('Bright Angel Trail')).toHaveCount(0);
});

test('trail card links to a detail page with metadata + safety callout', async ({ page }) => {
  await page.goto('/trails?park=zion');
  await page.getByText('Angels Landing Trail').click();
  await expect(page).toHaveURL(/\/trails\/nps%3Azion%3Aangels-landing-trail/);
  await expect(page.getByRole('heading', { name: 'Angels Landing Trail' })).toBeVisible();
  // Exact match: the page also has a "View Zion National Park →" action link, so /Zion National Park/ is ambiguous.
  await expect(page.getByRole('link', { name: 'Zion National Park', exact: true })).toBeVisible();
  await expect(page.getByText('Permit required')).toBeVisible();
  await expect(page.getByText('Plan smart, verify on site')).toBeVisible();
  // Route section renders whether or not Blob geometry is present (map when synced, a note when not) — assert
  // a geometry-independent metadata badge so the test doesn't depend on local trail geometry being absent.
  await expect(page.getByText('Point-to-point')).toBeVisible();
  // ADR-069: length/elevation/difficulty are labeled DERIVED ESTIMATES (what derive-trail-elevation feeds),
  // never a safety guarantee — the disclaimer must always render (geometry-independent).
  await expect(page.getByText(/estimates derived from open data/i)).toBeVisible();
  await expect(page.getByText(/not a safety guarantee/i)).toBeVisible();
});

test('trail detail shows the Phase-4 loop builder + Learn/Journeys cross-links (ADR-072)', async ({ page }) => {
  // Bright Angel is seeded with a CONNECTS (junctions 2) to South Kaibab → a rim-to-rim loop, and a
  // HIGHLIGHTS→Geology topic that cross-links the "Geology of Yellowstone" lesson.
  await page.goto('/trails/nps%3Agrca%3Abright-angel-trail');
  await expect(page.getByRole('heading', { name: 'Bright Angel Trail' })).toBeVisible();
  // Build a loop — the seeded two-junction connection stitches a loop + lists the connected trail.
  await expect(page.getByRole('heading', { name: 'Build a loop' })).toBeVisible();
  await expect(page.getByText('South Kaibab Trail').first()).toBeVisible();
  // Connect the dots — the shared Geology topic links the Ranger School lesson (Learn).
  await expect(page.getByRole('heading', { name: 'Connect the dots' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Geology of Yellowstone' })).toBeVisible();
});

test('the new /trails is real trails, not the thematic feature (now /journeys)', async ({ page }) => {
  await page.goto('/trails');
  // The thematic "Follow a story across the parks" headline must NOT be here anymore.
  await expect(page.getByRole('heading', { name: 'Follow a story across the parks' })).toHaveCount(0);
});
