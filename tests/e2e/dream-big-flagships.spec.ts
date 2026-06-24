import { test, expect, type Page } from '@playwright/test';

/**
 * E2E for the Dream-Big flagship surfaces that don't need the ranger model (DISABLE_EVE=1 in the e2e
 * webServer): live re-rank (no "0 matches" flash, §5.2), the dark-sky scorecard's Bortle tile, the
 * community SQM reading form (Collective Intelligence v2, ADR-053), Trip Lab fork + field-brief/offline
 * exports (ADR-056/057), and the /me ranger inbox + leaderboard (ADR-052/053). Assumes seeded fixtures
 * (yell/grca/glac). Authed flows use the E2E_TEST_MODE email/password sign-up.
 */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('live re-rank shows results without a "0 matches" flash (§5.2)', async ({ page }) => {
  await page.goto('/explore');
  // The progressive-enhancement panel mounts client-side.
  await expect(page.getByText('Refine live')).toBeVisible();
  // It must never show the empty-state copy while results are actually loading/available.
  await expect(page.getByText(/No parks match these constraints/)).toHaveCount(0);
  // The seeded parks rank in; a real result card appears and the count reads a number, not "0 matches".
  await expect(page.getByText(/\d+ match(es)?/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Yellowstone National Park').first()).toBeVisible({ timeout: 15000 });
});

test('dark-sky scorecard leads with a Bortle rating (§5.1 backfill path)', async ({ page }) => {
  // grca is seeded with bortleScale=2 — same render path the grba/bibe/deva backfill feeds.
  await page.goto('/parks/grca');
  await expect(page.getByRole('heading', { name: 'Conditions', exact: true })).toBeVisible();
  // The scorecard leads with the dark-sky rating + a Bortle value (text is split across nodes, so match
  // the label and "Bortle" separately rather than the combined "(Bortle 2)").
  await expect(page.getByText(/Excellent dark skies/).first()).toBeVisible();
  await expect(page.getByText(/Bortle/).first()).toBeVisible();
});

test('a signed-in visitor can log a community SQM reading (ADR-053)', async ({ page }) => {
  await signUp(page);
  await page.goto('/parks/grca');
  await expect(page.getByText('Log a sky reading')).toBeVisible();
  await page.getByPlaceholder('e.g. 21.6').fill('21.4');
  await page.getByRole('button', { name: 'Log reading' }).click();
  await expect(page.getByText(/Logged — thanks/i)).toBeVisible();

  // Out-of-range readings are rejected server-side.
  const bad = await page.request.post('/api/readings', { data: { parkCode: 'grca', sqm: 9 } });
  expect(bad.status()).toBe(400);
});

test('Trip Lab: fork a trip + field brief / offline pack export (ADR-056/057)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('Lab Trip E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Lab Trip E2E' })).toBeVisible();

  await page.getByPlaceholder(/Search parks by name/).fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();

  // Fork → the builder switches to the "(copy)". `exact` avoids matching the "Lab Trip E2E" selector button.
  await page.getByRole('button', { name: 'Fork', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Lab Trip E2E \(copy\)/ })).toBeVisible({ timeout: 15000 });

  // Field brief + offline pack endpoints return real artifacts.
  const briefHref = await page.getByRole('link', { name: 'Field brief' }).getAttribute('href');
  expect(briefHref).toMatch(/\/api\/trips\/.+\/brief/);
  const brief = await page.request.get(briefHref!);
  expect(brief.status()).toBe(200);
  expect(await brief.text()).toContain('field brief');

  const offlineHref = await page.getByRole('link', { name: 'Offline pack' }).getAttribute('href');
  const offline = await page.request.get(offlineHref!);
  expect(offline.status()).toBe(200);
  expect(offline.headers()['content-type']).toContain('application/zip');
});

test('the /me ranger inbox + dark-sky leaderboard render (ADR-052/053)', async ({ page }) => {
  await signUp(page);
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Ranger inbox' })).toBeVisible();
  // Build a digest on demand (no watches yet → empty, but the action wires end-to-end).
  await page.getByRole('button', { name: 'Refresh digest' }).click();
  // Email opt-in toggle is present and defaults OFF.
  await expect(page.getByText('Email me the digest')).toBeVisible();
  // Collective panel renders the leaderboard section.
  await expect(page.getByRole('heading', { name: 'Community dark-sky leaderboard' })).toBeVisible();
});
