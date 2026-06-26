import { test, expect } from '@playwright/test';

/**
 * /graph end-to-end (anon, DOM-only). The NVL canvas is WebGL — these tests assert the DOM CONTROLS that
 * `GraphConstellation` renders via the `legend` slot (which `NvlGraph` renders OUTSIDE the canvas-ready
 * gate, so it's present regardless of WebGL state), never the canvas pixels. Runs against the production
 * build with DISABLE_EVE/E2E_TEST_MODE; assumes the seeded fixtures (yell/grca/glac as National Parks).
 *
 * Embeddings note: e2e has no AI Gateway key, so the embedding-backed routes (`/api/graph/search` and
 * `/api/graph/query`) return 500 here — their wiring is asserted by AWAITING the request, and the UI's
 * graceful-failure path, not by a successful result subgraph (which needs the gateway). The pure-Cypher
 * routes (expand/lens/path/trip-path/analytics/ego) return 200 anon.
 */

test('/graph renders the National-Park count header and the core controls', async ({ page }) => {
  await page.goto('/graph');

  // Header: the signature panel (h1) + the live "<N> National Parks" count (N > 0 → at least one
  // non-zero leading digit). graphSeed emits every National-Park node, so the seeded yell/grca/glac count.
  await expect(page.getByRole('heading', { name: 'The park graph' })).toBeVisible();
  await expect(page.getByText(/[1-9]\d* National Parks/)).toBeVisible();

  // The NVL container itself mounts (canvas asserted elsewhere — here we only need the control surface).
  await expect(page.getByTestId('nvl-graph')).toBeVisible();

  // Legibility controls (#1): Fit button + layout switcher (defaulting to the "Force" / forceDirected layout).
  await expect(page.getByRole('button', { name: 'Fit the graph to view' })).toBeVisible();
  const layout = page.getByRole('combobox', { name: 'Graph layout' });
  await expect(layout).toBeVisible();
  await expect(layout).toHaveValue('forceDirected');

  // Edge-focus + path + trip toggles.
  await expect(page.getByRole('button', { name: 'Toggle edge focus' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle path mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle trip-select mode' })).toBeVisible();

  // Relationship lens (#4) combobox.
  await expect(page.getByRole('combobox', { name: 'Relationship lens' })).toBeVisible();

  // Find-a-node search box (#3): container testid + its labelled input.
  await expect(page.getByTestId('graph-search')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Find a node' })).toBeVisible();

  // Ask-the-graph bar (#5a): container testid + its labelled input + the Ask button.
  await expect(page.getByTestId('graph-query-bar')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask the graph' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible();
});

test('search box fires a debounced /api/graph/search request and returns graph-only hits', async ({ page }) => {
  await page.goto('/graph');

  const search = page.getByRole('textbox', { name: 'Find a node' });
  await expect(search).toBeVisible();

  // < 3 chars: no request (the box short-circuits client-side). Typing >= 3 chars fires one debounced GET.
  const searchResp = page.waitForResponse((r) => r.url().includes('/api/graph/search') && r.request().method() === 'GET');
  // 'Volcano' matches the seeded :Topic 'Volcanoes' via the embedding-INDEPENDENT CONTAINS path, so the box
  // degrades gracefully and returns 200 with a hit even when the AI Gateway / park embeddings are absent.
  await search.fill('Volcano');
  const resp = await searchResp;
  expect(resp.status()).toBe(200);
  await expect(page.getByTestId('graph-search').getByText(/Volcanoes/i).first()).toBeVisible();
});

test('relationship lens "Nearby" reveals the threshold slider and fetches /api/graph/lens', async ({ page }) => {
  await page.goto('/graph');

  const lens = page.getByRole('combobox', { name: 'Relationship lens' });
  await expect(lens).toBeVisible();

  // Switching off the default shares_topic lens fetches the lens edge set AND reveals the threshold slider.
  const lensResp = page.waitForResponse((r) => r.url().includes('/api/graph/lens') && r.request().method() === 'GET');
  await lens.selectOption({ label: 'Nearby' });
  const resp = await lensResp;
  expect(resp.status()).toBe(200); // pure Cypher (no embedding) → 200 anon

  // The slider (input[type=range], role "slider") appears for any non-default lens.
  await expect(page.getByRole('slider', { name: 'Lens threshold' })).toBeVisible();
});

test('path mode reveals the weighting select and the "Click two parks" hint', async ({ page }) => {
  await page.goto('/graph');

  await page.getByRole('button', { name: 'Toggle path mode' }).click();

  // Path mode (#6): the topical/driving weighting select + the pick-two-parks hint.
  await expect(page.getByRole('combobox', { name: 'Path weighting' })).toBeVisible();
  await expect(page.getByText('Click two parks')).toBeVisible();
});

test('trip mode reveals the trip action bar with disabled actions until a selection exists', async ({ page }) => {
  await page.goto('/graph');

  await page.getByRole('button', { name: 'Toggle trip-select mode' }).click();

  // Trip mode (#10): the action bar (testid) appears; Plan trip / Show route are disabled with no selection.
  const tripBar = page.getByTestId('graph-trip');
  await expect(tripBar).toBeVisible();
  await expect(tripBar.getByText(/click parks to add them to a trip/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Plan trip/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Show route' })).toBeDisabled();
});

test('ask-the-graph bar posts to /api/graph/query and renders an outcome', async ({ page }) => {
  await page.goto('/graph');

  const ask = page.getByRole('textbox', { name: 'Ask the graph' });
  await ask.fill('parks connected to John Muir');

  const queryResp = page.waitForResponse((r) => r.url().includes('/api/graph/query') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ask' }).click();
  const resp = await queryResp;
  // Public POST route; the NL→intent classification is embedding-backed (its logic is covered by the
  // graph-intents unit tests). E2e proves the bar is WIRED to the endpoint and renders SOME outcome line —
  // a narration/error <p>, candidate chips, or the ← Back pill — regardless of whether embeddings resolve.
  expect([200, 429, 500]).toContain(resp.status());
  await expect(page.getByTestId('graph-query-bar').locator('p').first()).toBeVisible();
});

test('insights panel renders only when graph analytics are materialized', async ({ page, request }) => {
  // The InsightsPanel (#7) renders NOTHING until the GDS-derived community/centrality/bridge props exist
  // (the seed alone doesn't materialize them). Assert the documented data-driven behavior either way.
  const analytics = await request.get('/api/graph/analytics');
  expect(analytics.status()).toBe(200);
  const data = (await analytics.json()) as {
    communities: unknown[];
    central: unknown[];
    bridges: unknown[];
  };
  const hasAnalytics =
    (data.communities?.length ?? 0) > 0 || (data.central?.length ?? 0) > 0 || (data.bridges?.length ?? 0) > 0;

  await page.goto('/graph');
  const panel = page.getByTestId('graph-insights');
  if (hasAnalytics) {
    await expect(panel).toBeVisible();
  } else {
    await expect(panel).toHaveCount(0);
  }
});

/* ── Anonymous graph endpoints (read-only, public; pure-Cypher ones return 200 without auth) ─────────── */

test('anon graph endpoints: expand/lens/path/trip-path/analytics/ego return 200', async ({ request }) => {
  const expand = await request.get('/api/graph/expand?key=yell&label=Park');
  expect(expand.status(), 'expand').toBe(200);

  const lens = await request.get('/api/graph/lens?lens=shares_topic');
  expect(lens.status(), 'lens').toBe(200);

  const path = await request.get('/api/graph/path?a=yell&b=grca&mode=topical');
  expect(path.status(), 'path').toBe(200);

  const trip = await request.get('/api/graph/trip-path?codes=yell,grca');
  expect(trip.status(), 'trip-path').toBe(200);

  const analytics = await request.get('/api/graph/analytics');
  expect(analytics.status(), 'analytics').toBe(200);

  const ego = await request.get('/api/graph/ego?key=yell&label=Park');
  expect(ego.status(), 'ego').toBe(200);
});

test('anon graph endpoints validate input before doing work', async ({ request }) => {
  // expand/ego require key + label; an unknown label is rejected by the closed allowlist.
  expect((await request.get('/api/graph/expand?key=yell')).status()).toBe(400); // missing label
  expect((await request.get('/api/graph/expand?key=yell&label=Bogus')).status()).toBe(400); // unknown label
  expect((await request.get('/api/graph/lens?lens=nope')).status()).toBe(400); // unknown lens
  expect((await request.get('/api/graph/path?a=yell')).status()).toBe(400); // missing b
  expect((await request.get('/api/graph/trip-path?codes=yell')).status()).toBe(400); // < 2 codes
});

test('graph search endpoint rejects too-short queries before any embedding', async ({ request }) => {
  // Length guard runs before the rate-limit + embedding, so this is deterministic without the AI Gateway.
  const res = await request.get('/api/graph/search?q=ab');
  expect(res.status()).toBe(400);
});

test('graph search endpoint is public and accepts a valid query', async ({ request }) => {
  const res = await request.get('/api/graph/search?q=canyon');
  // 200 with embeddings reachable; 500 in e2e (no AI Gateway key). Importantly NOT a 401/redirect — the
  // route is public — and NOT a 400 — a 3+ char query passes validation.
  expect([200, 500]).toContain(res.status());
});
