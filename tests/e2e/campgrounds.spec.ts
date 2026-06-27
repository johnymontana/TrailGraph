import { test, expect } from '@playwright/test';

/**
 * Multi-agency campgrounds finder + detail (Campgrounds feature). Uses the seeded fixtures: cg-canyon
 * (NPS, unified with RIDB facility 232449, 2 :Campsites incl. a tent/ADA site), cg-fishing-bridge (NPS),
 * and ridb:999001 (USFS dispersed, NEAR Yellowstone). Availability is gated OFF in e2e, so every chip
 * degrades to "Check on recreation.gov ↗" — the metadata + structure + the degrade are what we assert.
 */
test('campgrounds finder renders the filter form + seeded cards', async ({ page }) => {
  await page.goto('/campgrounds');
  await expect(page.getByRole('heading', { name: 'Find a campsite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  await expect(page.getByText('Canyon Campground')).toBeVisible();
  await expect(page.getByText('Gallatin Dispersed Area')).toBeVisible();
});

test('campgrounds finder filters by agency (USFS → only the dispersed forest site)', async ({ page }) => {
  await page.goto('/campgrounds?agency=USFS');
  await expect(page.getByText('Gallatin Dispersed Area')).toBeVisible();
  await expect(page.getByText('Canyon Campground')).toHaveCount(0);
});

test('campgrounds finder filters by free booking + shows the Dispersed badge', async ({ page }) => {
  await page.goto('/campgrounds?booking=free');
  await expect(page.getByText('Gallatin Dispersed Area')).toBeVisible();
  // "Dispersed" (exact) matches only the card badge — not the lowercase subtitle or the campground name.
  await expect(page.getByText('Dispersed', { exact: true })).toBeVisible();
});

test('availability chip degrades to a recreation.gov deep link when the flag is off', async ({ page }) => {
  await page.goto('/campgrounds?from=2030-07-03&to=2030-07-05');
  // cg-canyon has a ridbId → an availability chip is shown, but with the endpoint disabled it must be the
  // honest degrade, never a positive (open/green) or false-negative (booked-out/red).
  await expect(page.getByText('Check on recreation.gov ↗').first()).toBeVisible();
});

test('campground card links to a site-level detail page with inventory + provenance', async ({ page }) => {
  await page.goto('/campgrounds');
  await page.getByText('Canyon Campground').click();
  await expect(page).toHaveURL(/\/campgrounds\/cg-canyon/);
  await expect(page.getByRole('heading', { name: 'Canyon Campground' })).toBeVisible();
  // Site-level inventory (the differentiator) — the two seeded campsites.
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible();
  await expect(page.getByText('A012')).toBeVisible();
  await expect(page.getByText('B004')).toBeVisible();
  // Provenance reflects the NPS+RIDB unification, and the booking deep link is present.
  await expect(page.getByText(/merged from NPS \+ Recreation\.gov/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Book on Recreation\.gov/ })).toBeVisible();
});

test('Campgrounds appears in the primary nav', async ({ page }) => {
  await page.goto('/');
  // Desktop inline nav OR mobile drawer both render the LINKS array; assert the link exists in the DOM.
  await expect(page.getByRole('link', { name: 'Campgrounds' }).first()).toBeVisible();
});

test('comparison scorecard renders the radar + side-by-side fact table (Phase 3 viz)', async ({ page }) => {
  await page.goto('/campgrounds/compare?ids=cg-canyon,cg-fishing-bridge');
  await expect(page.getByRole('heading', { name: 'Compare campgrounds' })).toBeVisible();
  await expect(page.getByText('Canyon Campground vs Fishing Bridge RV Park')).toBeVisible();
  // The radar legend + the fact-table rows (over the structured inventory).
  await expect(page.getByText('Side-by-side')).toBeVisible();
  await expect(page.getByText('ADA sites')).toBeVisible();
  await expect(page.getByText('Dump station')).toBeVisible();
  await expect(page.getByText('Books out')).toBeVisible();
});

test('comparison page asks for 2+ campgrounds when given too few', async ({ page }) => {
  await page.goto('/campgrounds/compare?ids=cg-canyon');
  await expect(page.getByText('Pick 2–4 campgrounds to compare')).toBeVisible();
});
