import { test, expect, type Page } from '@playwright/test';

/** Fresh email+password user (E2E_TEST_MODE) so /me and /plan are authenticated. */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

/** Save a home via coordinates (the geolocation path — no ORS key in e2e, so the label degrades). */
async function saveHome(page: Page): Promise<void> {
  const res = await page.request.put('/api/me/home', {
    data: { latitude: 45.6793, longitude: -111.0429 }, // Bozeman, MT
  });
  expect(res.ok(), `home save failed: ${res.status()}`).toBeTruthy();
}

/**
 * Home location + trip origin (ADR-074). The coordinate path works keyless (reverse geocode degrades to
 * "My location"); the free-text path needs ORS, so it isn't exercised here beyond the error copy.
 */
test('home card on /me: save via coordinates, then forget', async ({ page }) => {
  await signUp(page);
  await saveHome(page);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Home location' })).toBeVisible();
  await expect(page.getByText('My location')).toBeVisible(); // reverse-geocode degraded label
  await page.getByRole('button', { name: 'Forget home' }).click();
  await expect(page.getByPlaceholder(/City, state/)).toBeVisible(); // back to the capture form
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
});

test('new trips start from home with a round trip; toggle and clear per trip', async ({ page }) => {
  await signUp(page);
  await saveHome(page);
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('Home Loop E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Home Loop E2E' })).toBeVisible();

  // Origin defaulted from home, round trip on.
  await expect(page.getByText(/Starts from/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Round trip: on/ })).toBeVisible();

  // Add a park so the origin leg (home → stop 1) renders.
  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();
  await expect(page.getByText(/⌂ My location ↓ \d+ mi/)).toBeVisible(); // first leg
  await expect(page.getByText(/mi · \d+ min back to ⌂/)).toBeVisible(); // return leg

  // Toggle the round trip off — the return leg goes away, the first leg stays.
  await page.getByRole('button', { name: /Round trip: on/ }).click();
  await expect(page.getByRole('button', { name: /Round trip: off/ })).toBeVisible();
  await expect(page.getByText(/back to ⌂/)).toHaveCount(0);
  await expect(page.getByText(/⌂ My location ↓ \d+ mi/)).toBeVisible();

  // Clear the origin — the trip reverts to first-stop start; home itself is untouched.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText(/No start point — route begins at the first stop/)).toBeVisible();
  const home = await page.request.get('/api/me/home');
  expect(((await home.json()) as { home: { label: string } | null }).home?.label).toBe('My location');
});

test('a trip origin can be set from scratch after clearing (input form)', async ({ page }) => {
  await signUp(page); // NO saved home → trips start unset
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('No Home E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(/No start point/)).toBeVisible();
  await page.getByRole('button', { name: 'Set a start point' }).click();
  await expect(page.getByPlaceholder(/Start from — e\.g\. Bozeman/)).toBeVisible();
  // Without an ORS key the geocode 404s server-side and surfaces the friendly toast, not a crash.
  await page.getByPlaceholder(/Start from — e\.g\. Bozeman/).fill('Bozeman, MT');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByText(/Couldn't find "Bozeman, MT"|Starts from/)).toBeVisible();
});

test('explore gains the distance-from-home sort and card distance line when home is set', async ({ page }) => {
  await signUp(page);
  await saveHome(page);
  await page.goto('/explore');
  await expect(page.getByLabel('Sort')).toBeVisible();
  await expect(page.getByText(/~\d+ mi from home/).first()).toBeVisible();

  // Sort by distance: Yellowstone (nearest seeded park to Bozeman) leads. Scope to the RESULTS grid —
  // the "For you" rail above it renders park links in its own (recommendation) order.
  await page.getByLabel('Sort').selectOption('home');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/sort=home/);
  const firstCard = page.getByTestId('explore-results').locator('a[href^="/parks/"]').first();
  await expect(firstCard).toHaveAttribute('href', '/parks/yell');
});

test('anonymous explore shows no home sort or distance lines', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByLabel('Sort')).toHaveCount(0);
  await expect(page.getByText(/mi from home/)).toHaveCount(0);
});
