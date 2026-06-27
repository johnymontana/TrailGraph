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
  await expect(page.getByRole('link', { name: /Zion National Park/ })).toBeVisible();
  await expect(page.getByText('Permit required')).toBeVisible();
  await expect(page.getByText('Plan smart, verify on site')).toBeVisible();
  // Geometry isn't synced in e2e → the route map degrades to its note.
  await expect(page.getByText(/route map appears once/i)).toBeVisible();
});

test('the new /trails is real trails, not the thematic feature (now /journeys)', async ({ page }) => {
  await page.goto('/trails');
  // The thematic "Follow a story across the parks" headline must NOT be here anymore.
  await expect(page.getByRole('heading', { name: 'Follow a story across the parks' })).toHaveCount(0);
});
