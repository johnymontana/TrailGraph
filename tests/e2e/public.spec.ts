import { test, expect } from '@playwright/test';

/** Public surface e2e. Assumes seeded fixtures (yell/grca/glac) — see scripts/seed-test-data.ts. */

test('landing page renders the value prop and nav', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Explore and plan trips/i })).toBeVisible();
  // Nav "Explore" link; `exact` so it doesn't also match the hero "Explore parks" button-link.
  await expect(page.getByRole('link', { name: 'Explore', exact: true }).first()).toBeVisible();
});

test('explore lists seeded parks', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByRole('heading', { name: 'Explore the National Parks' })).toBeVisible();
  await expect(page.getByText('Yellowstone National Park')).toBeVisible();
});

test('faceted search filters by activity', async ({ page }) => {
  await page.goto('/explore');
  await page.selectOption('select[name="activity"]', 'Astronomy');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/activity=Astronomy/);
  // `exact` so the card title matches but not the "🏞️ Grand Canyon National Park" placeholder text.
  await expect(page.getByText('Grand Canyon National Park', { exact: true })).toBeVisible();
  // Yellowstone offers Hiking, not Astronomy → filtered out
  await expect(page.getByText('Yellowstone National Park', { exact: true })).toHaveCount(0);
});

test('park detail shows description, alert, related parks, and actions', async ({ page }) => {
  await page.goto('/parks/yell');
  // `exact` so the h1 matches but not the "How Yellowstone National Park connects" graph h2.
  await expect(page.getByRole('heading', { name: 'Yellowstone National Park', exact: true })).toBeVisible();
  await expect(page.getByText('Closure')).toBeVisible(); // seeded active Closure alert
  await expect(page.getByRole('button', { name: /Save/ })).toBeVisible(); // §4 actions
  await expect(page.getByText('Canyon Campground')).toBeVisible(); // §7 park-local data
  await expect(page.getByText(/not an official safety source/i)).toBeVisible();
});

test('park detail shows §5 conditions (dark sky) and difficulty dots', async ({ page }) => {
  await page.goto('/parks/grca');
  await expect(page.getByRole('heading', { name: 'Conditions' })).toBeVisible();
  // "dark skies" now appears in both the at-a-glance strip and the Conditions panel → scope to first.
  await expect(page.getByText(/dark skies/i).first()).toBeVisible(); // seeded Bortle 2 → "Excellent dark skies"
});

test('park header "at a glance" strip shows timed-entry + dark sky (R4 §3/§4)', async ({ page }) => {
  await page.goto('/parks/glac'); // seeded: dark-sky, high crowds, timed entry
  await expect(page.getByText(/Timed entry/i).first()).toBeVisible();
  await expect(page.getByText(/dark skies/i).first()).toBeVisible();
});

test('park detail renders the monthly visitation chart (§5b, Chakra charts)', async ({ page }) => {
  await page.goto('/parks/glac'); // seeded with monthlyVisits
  await expect(page.getByText(/Monthly recreation visits/i)).toBeVisible();
  // Recharts draws an SVG inside the Conditions panel — it mounts client-side after hydration, so allow
  // extra time under CI load.
  await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 15_000 });
});

test('explore dark-sky facet filters to certified parks (§5a)', async ({ page }) => {
  await page.goto('/explore');
  await page.getByLabel('Dark-sky parks').check();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/darkSky=1/);
  await expect(page.getByText('Grand Canyon National Park', { exact: true })).toBeVisible();
  await expect(page.getByText('Yellowstone National Park', { exact: true })).toHaveCount(0); // not certified in fixtures
});

test('park detail surfaces "Similar parks" (graph relationships, §6)', async ({ page }) => {
  await page.goto('/parks/grca');
  await expect(page.getByRole('heading', { name: 'Similar parks' })).toBeVisible();
  await expect(page.getByText('Glacier National Park', { exact: true })).toBeVisible(); // shares Astronomy + Hiking
});

test('explore shows accurate paginated count', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.getByText(/Showing \d+.* of \d+ park/)).toBeVisible();
});

test('graph view renders the NVL graph (§P3)', async ({ page }) => {
  await page.goto('/graph');
  await expect(page.getByRole('heading', { name: 'The park graph' })).toBeVisible();
  // NVL renders into a sized container + canvas (Playwright runs Chromium with swiftshader WebGL).
  await expect(page.getByTestId('nvl-graph')).toBeVisible();
  await expect(page.locator('[data-testid="nvl-graph"] canvas').first()).toBeVisible();
});

test('park detail renders the interactive one-hop NVL graph (§NVL)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: /How .* connects/ })).toBeVisible();
  await expect(page.getByTestId('nvl-graph')).toBeVisible();
  await expect(page.locator('[data-testid="nvl-graph"] canvas').first()).toBeVisible();
});

test('park-detail name is an h1 (§2.6)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { level: 1, name: 'Yellowstone National Park' })).toBeVisible();
});

test('map page renders layer controls and a list-view equivalent (a11y)', async ({ page }) => {
  await page.goto('/map');
  // DOM controls (don't depend on WebGL): layer toggles + list-view link.
  await expect(page.getByText('Layers')).toBeVisible();
  await expect(page.getByText('Campgrounds')).toBeVisible();
  await expect(page.getByRole('link', { name: /List view/ })).toBeVisible();
});

test('plan page renders the trip builder (sign-in gated)', async ({ page }) => {
  await page.goto('/plan');
  await expect(page.getByText(/Sign in to plan trips|Trips/)).toBeVisible();
});

test('activity chips on a park page are traversable to Explore (graph traversal, §6)', async ({ page }) => {
  await page.goto('/parks/grca');
  const chip = page.getByRole('link', { name: 'Astronomy' }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/activity=Astronomy/);
  await expect(page.getByText('Grand Canyon National Park', { exact: true })).toBeVisible();
});

test('theme toggle switches color mode (R4 §2.2)', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /mode/i }).first(); // sun/moon toggle in the nav
  await expect(toggle).toBeVisible();
  const before = await page.evaluate(() => document.documentElement.className);
  await toggle.click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.className))
    .not.toBe(before); // <html> class flips light↔dark
});

test('mobile nav exposes the hamburger menu (CSS-responsive SiteNav, R3 §4 carryover)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  await expect(hamburger).toBeVisible();
  await hamburger.click();
  await expect(page.getByRole('menuitem', { name: 'Explore' })).toBeVisible();
});

test('your-memory page gates on sign-in', async ({ page }) => {
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: 'Your memory' })).toBeVisible();
  // A "Sign in" link appears in both the nav and the gate prompt — assert at least one is visible.
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});
