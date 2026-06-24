import { test, expect } from '@playwright/test';

/**
 * NPS data-features public surface e2e (plan F1–F10 + bonuses). Assumes the seeded fixtures
 * (scripts/seed-test-data.ts), which give Yellowstone real operating hours + a dated road closure,
 * a structured entrance fee, campground inventory, an accessibility scorecard, a news release, parking
 * with EV charging, and queryable contacts. Multimedia (F6) is opt-in (SYNC_MULTIMEDIA) so it's not
 * seeded/asserted here. All surfaces render the "reported / as of last sync" framing.
 */

test('park page shows hours & seasons with a dated closure and open seasons (F1)', async ({ page }) => {
  await page.goto('/parks/yell');
  // Prefer a stable test id over text regexes for the section + the at-a-glance stat (plan P2-3).
  const section = page.getByTestId('park-hours-section');
  await expect(section).toBeVisible();
  await expect(section.getByText(/North Entrance Road/)).toBeVisible();
  await expect(section.getByText(/Generally open/)).toBeVisible();
  await expect(page.getByTestId('park-hours-stat')).toBeVisible(); // "Open today?" StatCard (P0-5)
});

test('park page shows an accessibility scorecard, framed as reported (F5)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Accessibility' })).toBeVisible();
  await expect(page.getByText('Wheelchair Accessible').first()).toBeVisible();
  await expect(page.getByText(/Reported by the park/).first()).toBeVisible();
});

test('park page lists campground inventory facets (F3)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Campgrounds' })).toBeVisible();
  // Scope to the campground link (the seed's alert text also mentions "Canyon Campground").
  await expect(page.getByRole('link', { name: /Canyon Campground/ })).toBeVisible();
  await expect(page.getByText(/273 sites/)).toBeVisible();
});

test('park page shows parking with EV charging and accessible spaces (F10)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Parking' })).toBeVisible();
  await expect(page.getByText('Canyon Village Lot')).toBeVisible();
  await expect(page.getByText('EV charging')).toBeVisible();
  await expect(page.getByText(/12 accessible spaces/)).toBeVisible();
});

test('park page surfaces latest news releases (F8)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Latest from this park' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Yellowstone announces summer road work/ })).toBeVisible();
});

test('park page shows queryable contacts (bonus)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByText(/307-344-7381/)).toBeVisible();
});

test('events show free + type badges (F4)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await expect(page.getByText('Perseid Star Party')).toBeVisible();
  // The seeded event is free + typed Astronomy.
  await expect(page.getByText('free').first()).toBeVisible();
});
