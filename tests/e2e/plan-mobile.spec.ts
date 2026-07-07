import { test, expect, type Page } from '@playwright/test';
import { openPane, isMobileViewport } from './helpers/pane';

/**
 * The /plan mobile shell (ADR-076): tab bar + one-pane-at-a-time panes over a single mounted tree.
 * Runs in BOTH Playwright projects — the hydration gate matters everywhere (the anonymous
 * hydration.spec.ts never renders the authed shell: /plan redirects to /signin), while the tab-bar
 * tests self-skip on desktop where all three panes are simultaneously visible. DOM assertions only
 * (no WebGL), per the suite convention.
 */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

const HYDRATION_RX = /hydrat|did not match|text content does not match|tree hydrated|css-\w+/i;

test('authed /plan hydrates clean (the shell adds no breakpoint-branched markup)', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && HYDRATION_RX.test(m.text())) {
      problems.push(`[console.${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => {
    if (HYDRATION_RX.test(e.message)) problems.push(`[pageerror] ${e.message}`);
  });
  await signUp(page);
  await page.goto('/plan', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  expect(problems, problems.join('\n')).toHaveLength(0);
});

test('tab switching preserves pane state — nothing unmounts (ADR-076)', async ({ page }) => {
  test.skip(!isMobileViewport(page), 'tab bar is mobile-only; desktop shows all panes');
  await signUp(page);
  await page.goto('/plan');
  await expect(page.getByTestId('plan-tab-bar')).toBeVisible();

  // Default pane: Itinerary. The chat pane exists but is CSS-hidden (mounted once, never unmounted).
  await expect(page.getByPlaceholder('New trip name')).toBeVisible();
  const emptyState = page.getByText('Ask the ranger to plan a trip, find parks, or check conditions.');
  await expect(emptyState).toBeHidden();

  // Type a draft into the chat input, leave, come back: a remount would wipe the draft (the Eve chat
  // store is per-component and in-memory) — its survival IS the no-unmount guarantee under test.
  await openPane(page, 'ranger');
  await expect(emptyState).toBeVisible();
  const input = page.getByPlaceholder(/Plan a trip with the ranger/);
  await input.fill('draft: dark-sky trip in Utah');
  await openPane(page, 'map');
  await expect(input).toBeHidden();
  await openPane(page, 'ranger');
  await expect(input).toHaveValue('draft: dark-sky trip in Utah');
});

test('typeahead add updates the tab count, then the map badge; the pill returns (ADR-076)', async ({ page }) => {
  test.skip(!isMobileViewport(page), 'tab bar is mobile-only; desktop shows all panes');
  await signUp(page);
  await page.goto('/plan');
  await page.getByPlaceholder('New trip name').fill('Shell E2E');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Shell E2E' })).toBeVisible();

  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill('Yellowstone');
  await page.getByText('Yellowstone National Park').click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();
  // Same-pane feedback: the tab-bar count (bare numeral — never the map chip's "<n> stop(s)" string).
  await expect(page.getByTestId('plan-tab-stops')).toHaveText('1');

  // Cross-pane truth: the Map pane's metrics overlay shows the same add.
  await openPane(page, 'map');
  await expect(page.getByText(/1 stop\b/)).toBeVisible();

  // The map pane's "View itinerary" pill switches back (the setPane context path).
  await page.getByRole('button', { name: 'View itinerary' }).click();
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();
});

test('?pane=ranger deep link opens the Ranger pane (ADR-076)', async ({ page }) => {
  test.skip(!isMobileViewport(page), 'tab bar is mobile-only; desktop shows all panes');
  await signUp(page);
  await page.goto('/plan?pane=ranger');
  await expect(page.getByText('Ask the ranger to plan a trip, find parks, or check conditions.')).toBeVisible();
  // The itinerary pane is mounted but hidden.
  await expect(page.getByPlaceholder('New trip name')).toBeHidden();
});
