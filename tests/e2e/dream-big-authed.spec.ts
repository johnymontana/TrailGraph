import { test, expect } from '@playwright/test';

/**
 * Authenticated e2e for the Dream-Big surfaces that don't need the ranger model (DISABLE_EVE=1 in the
 * e2e webServer): the Trip Dashboard + GPX/ICS export (ADR-042/048), the living context graph on /me,
 * and the Why-this-park provenance popover (ADR-047). Uses E2E_TEST_MODE email/password sign-up.
 * Assumes seeded fixtures (yell/grca/glac).
 */
async function signUp(page: import('@playwright/test').Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('Trip Dashboard + GPX/ICS export return valid files (ADR-042/048)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('Export E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Export E2E' })).toBeVisible();

  await page.getByPlaceholder(/Search parks by name/).fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();

  // Trip conditions dashboard (W1): per-stop instruments render for the built trip.
  await page.getByRole('button', { name: 'Trip conditions' }).click();
  await expect(page.getByText('Crowds').first()).toBeVisible(); // Yellowstone has a seeded crowd level

  // Export endpoints: the export anchors live in the "More" action menu (Plan UX Phase 0) — open it,
  // then fetch the hrefs and assert real file bodies. Menu items are role=menuitem, not link.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const gpxHref = await page.getByRole('menuitem', { name: 'Export .gpx' }).getAttribute('href');
  const icsHref = await page.getByRole('menuitem', { name: 'Export .ics' }).getAttribute('href');
  expect(gpxHref).toMatch(/\/api\/trips\/.+\/gpx/);
  const gpx = await page.request.get(gpxHref!);
  expect(gpx.status()).toBe(200);
  expect(await gpx.text()).toContain('<gpx version="1.1"');
  const ics = await page.request.get(icsHref!);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain('BEGIN:VCALENDAR');
});

test('a saved preference renders the /me context graph + the Why-this-park popover (ADR-047)', async ({ page }) => {
  await signUp(page);
  // Seed a preference (canonicalizes to Astronomy → grca/glac offer it).
  const r = await page.request.post('/api/memory', {
    data: { op: 'addPreference', category: 'activity', value: 'stargazing' },
  });
  expect(r.ok(), `addPreference failed: ${r.status()}`).toBeTruthy();

  // /me renders the living context graph (NVL) above the memory list.
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: /What the ranger remembers/i })).toBeVisible();
  await expect(page.getByText(/remembers about you, as a graph/i)).toBeVisible();
  await expect(page.getByTestId('nvl-graph')).toBeVisible();

  // /explore "For you" → Why this park popover reads the literal provenance edges.
  await page.goto('/explore');
  const why = page.getByRole('button', { name: /Why this park/i }).first();
  await expect(why).toBeVisible();
  await why.click();
  await expect(page.getByText(/you said/i).first()).toBeVisible(); // "— you said "stargazing""
});
