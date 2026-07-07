import { test, expect, type Page } from '@playwright/test';
import { openPane } from './helpers/pane';

/** Fresh email+password user (E2E_TEST_MODE) so /plan is authenticated. */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

/**
 * Build-on-map canvas (#9): adding parks bubbles the live running-total metrics badge. We add via the name
 * typeahead (deterministic; clicking the WebGL canvas isn't), and assert the badge (a DOM overlay) updates —
 * which exercises the addStop → metrics-in-response → applyMutation → badge path end-to-end. Under the
 * mobile shell (ADR-076) the badge lives in the Map pane, so openPane switches there before each badge
 * assertion (a no-op on desktop, where all panes are visible).
 */
test('build-on-map: adding parks surfaces the live metrics badge (#9)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('Canvas E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Canvas E2E' })).toBeVisible();

  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();
  await openPane(page, 'map');
  await expect(page.getByText(/1 stop\b/)).toBeVisible(); // live metrics badge (map-pane overlay)

  await openPane(page, 'itinerary');
  await search.fill('Glacier');
  await page.getByText('Glacier National Park').click();
  await expect(page.getByText(/2\. Glacier/)).toBeVisible();
  await openPane(page, 'map');
  await expect(page.getByText(/2 stops/)).toBeVisible(); // badge updates as the plan grows
});
