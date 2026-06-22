import { test, expect } from '@playwright/test';

/**
 * Authenticated flows (Phase 2/3). Uses E2E_TEST_MODE email+password sign-up (no email round-trip).
 * Assumes seeded fixtures (yell/glac with a Yellowstone Closure alert).
 */
async function signUp(page: import('@playwright/test').Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('build a trip: create → add stops → drive segment → day plan → alerts', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');

  await page.getByPlaceholder('New trip name').fill('E2E Trip');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Trip' })).toBeVisible();

  // Add stops via the name typeahead (§2.5).
  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();

  await search.fill('Glacier');
  await page.getByText('Glacier National Park').click();
  await expect(page.getByText(/Glacier/)).toBeVisible();

  // Drive segment between the two stops (great-circle fallback if ORS absent).
  await expect(page.getByText(/mi ·/)).toBeVisible();

  // Day-by-day structuring (C4).
  await page.getByRole('button', { name: 'Suggest day plan' }).click();
  await expect(page.getByText('Day 1')).toBeVisible();

  // Graph-aware ordering (§P3) — reorders without error; stops still present.
  await page.getByRole('button', { name: 'Optimize route' }).click();
  await expect(page.getByText(/Yellowstone|Glacier/).first()).toBeVisible();

  // Per-trip alert check (C3) — Yellowstone has a seeded Closure alert.
  await page.getByRole('button', { name: 'Check alerts' }).click();
  await expect(page.getByText(/Closure|No active/)).toBeVisible();

  // Shareable read-only link (C6).
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByText(/Read-only link:/)).toBeVisible();
  await expect(page.getByText(/\/trips\/shared\//)).toBeVisible();
});

test('saving a park records it under "Parks you\'ve considered" on /me (§5)', async ({ page }) => {
  await signUp(page);
  await page.goto('/parks/grca');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible();

  await page.goto('/me');
  await expect(page.getByRole('heading', { name: /Parks you.*considered/ })).toBeVisible();
  await expect(page.getByText('Grand Canyon National Park')).toBeVisible({ timeout: 15_000 });
});

test('"Clear all" empties considered parks (R3 §2.7)', async ({ page }) => {
  await signUp(page);
  await page.goto('/parks/grca');
  await page.getByRole('button', { name: /Save/ }).click();
  await page.goto('/me');
  await expect(page.getByText('Grand Canyon National Park')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('None yet.')).toBeVisible();
});

test('onboarding seeds a preference that shows on /me (§5)', async ({ page }) => {
  await signUp(page);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Dark skies' }).click(); // → canonicalizes to Astronomy
  await page.getByRole('button', { name: /Save/ }).click();
  await page.waitForURL('**/me');
  // The canonical preference (Astronomy) lands as a PREFERS bridge and renders on the memory page.
  await expect(page.getByText('Astronomy')).toBeVisible({ timeout: 15_000 });
});
