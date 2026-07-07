import { test, expect } from '@playwright/test';
import { openPane } from './helpers/pane';

/**
 * Plan-ranger quality hardening — the non-ranger-dependent surfaces (e2e runs with DISABLE_EVE, so the
 * chat agent is off; these assert UI that renders without a model turn):
 *   • P1.5/P2.4 — the "Surprise me" + "Plan a school field trip" starter chips on the empty chat state.
 *   • P2.2 — trip names containing "&" render the real character (not the `&amp;` entity).
 *   • P1.2 — per-trip alerts render as the structured AlertList + a header alert-count badge.
 * Uses E2E_TEST_MODE email+password sign-up + the seeded fixtures (Yellowstone has a Closure alert).
 */
async function signUp(page: import('@playwright/test').Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('the chat empty state offers the Surprise-me + Field-trip starters (P1.5/P2.4)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  // Under the mobile shell the chat is a hidden pane behind the Ranger tab (no-op on desktop).
  await openPane(page, 'ranger');
  // The empty-state lead + the new starter chips (rendered statically, no ranger turn needed).
  await expect(page.getByText('Ask the ranger to plan a trip, find parks, or check conditions.')).toBeVisible();
  await expect(page.getByText(/Surprise me/)).toBeVisible();
  await expect(page.getByText(/Plan a school field trip/)).toBeVisible();
});

test('trip names with "&" render the real character, never the &amp; entity (P2.2)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');

  await page.getByPlaceholder('New trip name').fill('Stars & Skies');
  await page.getByRole('button', { name: 'Create' }).click();

  // Header (decoded on render) shows the real ampersand…
  await expect(page.getByRole('heading', { name: 'Stars & Skies' })).toBeVisible();
  // …and the raw entity is nowhere on the page (sidebar button + header).
  await expect(page.getByText('Stars &amp; Skies')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Stars & Skies/ })).toBeVisible();
});

test('per-trip alerts render as the structured card + a header alert badge (P1.2)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');

  await page.getByPlaceholder('New trip name').fill('Alerts E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Alerts E2E' })).toBeVisible();

  // Add Yellowstone (seeded with a Closure alert).
  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();

  // Populate alerts (the same state the auto-fetch-on-open uses), then assert the structured card.
  await page.getByRole('button', { name: 'Check alerts' }).click();
  await expect(page.getByText('Yellowstone National Park').last()).toBeVisible();
  await expect(page.getByText('Closure').first()).toBeVisible();

  // …and the header surfaces a persistent alert-count badge derived from that state.
  await expect(page.getByText(/\d+ alerts?/).first()).toBeVisible();
});
