import { test, expect } from '@playwright/test';

/**
 * NPS-expansion public surface e2e. Assumes the seeded fixtures (scripts/seed-test-data.ts), which
 * give Yellowstone a Person (Ferdinand Hayden), a Tour, a passport stamp, a Place, an Article, a
 * parking lot, and an event. Live conditions (webcams/roadevents) are an on-demand NPS fetch and are
 * intentionally NOT asserted here (coverage/quota-dependent → flaky).
 */

test('thematic trails page lists people and traces a cross-park trail', async ({ page }) => {
  await page.goto('/trails');
  // PageHeader h1 after the redesign ("Thematic trails" is now the eyebrow).
  await expect(page.getByRole('heading', { name: 'Follow a story across the parks' })).toBeVisible();

  // Pick a multi-park figure → see the trail.
  await page.getByRole('link', { name: /Ferdinand Hayden/ }).click();
  await expect(page).toHaveURL(/person=Ferdinand(%20|\+)Hayden/);
  await expect(page.getByRole('heading', { name: /Parks tied to Ferdinand Hayden/ })).toBeVisible();
  // `exact` so the card title matches but not the "🏞️ … National Park" placeholder text.
  await expect(page.getByText('Yellowstone National Park', { exact: true })).toBeVisible();
  await expect(page.getByText('Glacier National Park', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /See it on the graph/ })).toBeVisible();
});

test('trails nav link is present in the header', async ({ page }) => {
  await page.goto('/');
  // `exact` so the nav "Trails" link doesn't also match the footer's "Thematic trails" link.
  await expect(page.getByRole('link', { name: 'Trails', exact: true })).toBeVisible();
});

test('park page surfaces People & stories', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'People & stories' })).toBeVisible();
  await expect(page.getByText('Ferdinand Hayden')).toBeVisible();
});

test('park page surfaces an official tour with a "Start a trip" action', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Take a tour' })).toBeVisible();
  await expect(page.getByText('Canyon Rim Tour')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a trip' }).first()).toBeVisible();
});

test('park page surfaces passport stamps, events, places, articles, and parking', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Passport stamps' })).toBeVisible();
  // The stamp renders as "🎫 Canyon Village"; scope to it so it doesn't collide with "Canyon Village Lot".
  await expect(page.getByText('🎫 Canyon Village')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  await expect(page.getByText('Perseid Star Party')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Places to see' })).toBeVisible();
  await expect(page.getByText('Artist Point')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Learn more' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Geysers of Yellowstone/ })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Parking' })).toBeVisible();
  await expect(page.getByText('Canyon Village Lot')).toBeVisible();
});

test('unified search page renders its query form and is in the nav', async ({ page }) => {
  await page.goto('/');
  // `exact` so the nav "Search" link doesn't also match the footer's "Vibe search" link.
  await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible();

  await page.goto('/search');
  // PageHeader h1 after the redesign ("Vibe search" is now the eyebrow; the bare "Search" h1 is gone).
  await expect(page.getByRole('heading', { name: 'Search by meaning, not keywords', level: 1 })).toBeVisible();
  await expect(page.getByPlaceholder(/quiet alpine overlook/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  // No query yet → prompt, not results. (Semantic results need populated embeddings + the AI Gateway,
  // which CI/e2e don't have — same reason vibeSearch has no e2e; results aren't asserted here.)
  await expect(page.getByText(/search across parks, places/i)).toBeVisible();
});

test('explore exposes an amenity facet that filters parks', async ({ page }) => {
  await page.goto('/explore');
  await page.selectOption('select[name="amenity"]', 'Accessible Restrooms');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/amenity=Accessible/);
  await expect(page.getByText('Yellowstone National Park', { exact: true })).toBeVisible();
});
