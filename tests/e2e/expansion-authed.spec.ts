import { test, expect, type Page } from '@playwright/test';

/**
 * NPS-expansion authenticated flows: accessibility/pass/stamp/availability controls on /me, passport
 * stamp collection, tour→trip seeding, and the trip cost model. Uses E2E_TEST_MODE email+password
 * sign-up (no email round-trip), like authed.spec.ts. Assumes the seeded fixtures.
 */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('"How you travel" controls persist a wheelchair constraint (P0)', async ({ page }) => {
  await signUp(page);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'How you travel' })).toBeVisible();
  // RV + travel-date controls render.
  await expect(page.getByText('RV / trailer length (ft)')).toBeVisible();
  await expect(page.getByText('Travel dates')).toBeVisible();

  // Toggle wheelchair on; the button label flips to "Required" once the server round-trips.
  // Only the wheelchair row carries an "Off" button, so this is unambiguous.
  await expect(page.getByText('Wheelchair-accessible sites')).toBeVisible();
  await page.getByRole('button', { name: 'Off' }).click();
  await expect(page.getByRole('button', { name: 'Required' })).toBeVisible();
});

test('records holding the America the Beautiful pass on /me (P2)', async ({ page }) => {
  await signUp(page);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Passes & stamps' })).toBeVisible();
  await page.getByRole('button', { name: 'I have it' }).click();
  await expect(page.getByRole('button', { name: 'Held ✓' })).toBeVisible();
});

test('collecting a passport stamp on a park page shows it on /me (P2)', async ({ page }) => {
  await signUp(page);
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Passport stamps' })).toBeVisible();
  await page.getByRole('button', { name: 'Collect' }).first().click();
  await expect(page.getByRole('button', { name: 'Collected ✓' })).toBeVisible();

  await page.goto('/me');
  await expect(page.getByText(/Collected stamps/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Canyon Village/)).toBeVisible();
});

test('starting a trip from an official tour seeds ordered stops in the builder (P1)', async ({ page }) => {
  await signUp(page);
  await page.goto('/parks/yell');
  await page.getByRole('button', { name: 'Start a trip' }).first().click();
  await page.waitForURL('**/plan?trip=*');
  // The tour's stops are materialized: a Place + a Visitor Center, each labeled (not "Stop").
  await expect(page.getByText('Artist Point')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Canyon Visitor Education Center')).toBeVisible();
});

test('trip cost model estimates entrance fees (P2)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('Cost E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Cost E2E' })).toBeVisible();

  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();

  await page.getByRole('button', { name: 'Trip cost' }).click();
  await expect(page.getByText('Estimated entrance fees')).toBeVisible();
  // A single-park trip renders $35 twice (per-park line + bold total), so scope to the first match.
  await expect(page.getByText('$35').first()).toBeVisible(); // Yellowstone seeded at $35
});
