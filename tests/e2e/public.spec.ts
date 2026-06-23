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
  // PageHeader h1 after the redesign (was "Explore the National Parks").
  await expect(page.getByRole('heading', { name: 'Find your park' })).toBeVisible();
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
  // `exact` so it matches the "Closure" category badge, not the alert title ("Road closure near …"),
  // which `getByText` would otherwise match case-insensitively as a substring.
  await expect(page.getByText('Closure', { exact: true })).toBeVisible(); // seeded active Closure alert
  await expect(page.getByRole('button', { name: /Save/ })).toBeVisible(); // §4 actions
  // The campground is a reservation link; scope to the link so it doesn't collide with the seeded
  // alert text ("Road closure near Canyon Campground"), which is plain text.
  await expect(page.getByRole('link', { name: /Canyon Campground/ })).toBeVisible(); // §7 park-local data
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
  // VisitationChart only renders this caption when it has the full 12-month array, so its presence
  // proves the §5b chart mounted with valid data. (We don't assert recharts' internal `.recharts-surface`
  // SVG — it needs a measured container and is flaky in headless CI; the caption is the durable signal.)
  await expect(page.getByText(/Monthly recreation visits/i)).toBeVisible({ timeout: 15_000 });
});

test('explore dark-sky facet filters to certified parks (§5a)', async ({ page }) => {
  await page.goto('/explore');
  // The Chakra Checkbox hides the real <input> off-screen and the visual control intercepts pointer
  // events, so toggle it the way a user would — by clicking the label — instead of `.check()` on the input.
  await page.getByText('Dark-sky parks').click();
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

test('plan page redirects anonymous users to sign-in (ADR-038 gating)', async ({ page }) => {
  // The ranger + memory writes are useless without a session, so /plan now redirects to /signin rather
  // than rendering a builder that silently persists nothing.
  await page.goto('/plan');
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole('heading', { name: /Sign in to TrailGraph/i })).toBeVisible();
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
  // The mobile menu is now a Drawer (dialog) of links, not a Menu of menuitems. Scope to the dialog so
  // the (display:none) desktop "Explore" link doesn't create a strict-mode ambiguity.
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Explore', exact: true })).toBeVisible();
});

test('your-memory page gates on sign-in', async ({ page }) => {
  await page.goto('/me');
  // Signed-out /me now renders a branded empty state (EmptyState title isn't a heading element).
  await expect(page.getByText(/Your memory lives here/i)).toBeVisible();
  // A "Sign in" affordance appears in both the nav and the gate CTA — assert at least one is visible.
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('sign-in page explains the account model (ADR-038 P0.2)', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: /Sign in to TrailGraph/i })).toBeVisible();
  await expect(page.getByText(/Browse freely without an account/i)).toBeVisible();
  await expect(page.getByText(/unlock the ranger/i)).toBeVisible();
});

test('signed-out nav shows a Sign in link, not an account menu (ADR-038)', async ({ page }) => {
  await page.goto('/');
  // The account control resolves after mount (mounted-gated) → anonymous shows "Sign in".
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
});

test('explore cards surface dark-sky ⭐ and accessibility ♿ badges (ADR-039 P2.10)', async ({ page }) => {
  await page.goto('/explore');
  // grca/glac are dark-sky certified in fixtures; yell has a wheelchair-accessible campground.
  await expect(page.getByTitle('Dark-sky park').first()).toBeVisible();
  await expect(page.getByTitle('Wheelchair-accessible camping').first()).toBeVisible();
});

test('global footer shows the canonical NPS disclaimer + brand', async ({ page }) => {
  await page.goto('/');
  // The redesign centralizes the NPS disclaimer in a global <footer> (role contentinfo), shown on
  // content routes (hidden on the full-screen map/graph/plan routes via FooterGate).
  const footer = page.getByRole('contentinfo');
  await expect(footer).toBeVisible();
  await expect(footer.getByRole('link', { name: /NPS\.gov/i })).toBeVisible();
});

test('image-less park card shows the branded placeholder (ADR-039 #11)', async ({ page }) => {
  await page.goto('/explore');
  // grca has no dataset image → the deterministic placeholder renders "🏞️ <name>".
  await expect(page.getByText('🏞️ Grand Canyon National Park')).toBeVisible();
});

test('trails: theme chips render and a person trail shows the NVL mini-graph + parks (ADR-039 P1.5)', async ({ page }) => {
  await page.goto('/trails');
  // PageHeader h1 after the redesign ("Thematic trails" is now the eyebrow).
  await expect(page.getByRole('heading', { name: 'Follow a story across the parks' })).toBeVisible();
  // Ferdinand Hayden is seeded across yell + glac (≥2 parks → a People chip).
  const chip = page.getByRole('link', { name: /Ferdinand Hayden/ });
  await expect(chip).toBeVisible();
  await chip.click();

  await expect(page).toHaveURL(/person=Ferdinand/);
  // The mini-graph mounts into the shared NVL container (the durable signal; the inner WebGL canvas is
  // asserted only by the dedicated /graph tests, where it's allowed to be flaky-with-retries).
  await expect(page.getByTestId('nvl-graph')).toBeVisible();
  // …and the connected parks still appear as cards below.
  await expect(page.getByText('Yellowstone National Park', { exact: true })).toBeVisible();
  await expect(page.getByText('Glacier National Park', { exact: true })).toBeVisible();
  // "See it on the graph →" is pulled alongside the trail.
  await expect(page.getByRole('link', { name: /See it on the graph/ })).toBeVisible();
});
