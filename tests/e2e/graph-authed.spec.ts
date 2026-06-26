import { test, expect, type Page } from '@playwright/test';

/**
 * /graph authenticated DOM flows. Uses E2E_TEST_MODE email+password sign-up (no email round-trip), like
 * authed.spec.ts / expansion-authed.spec.ts. DOM-only — never the WebGL canvas.
 *
 * Scope note: the per-park provenance ("Why this?") + "More like this" actions live in the `graph-selection`
 * panel, which only appears AFTER clicking a node on the NVL CANVAS — there is no DOM control to open it, so
 * it is intentionally NOT covered here (it would require asserting a canvas interaction). The DOM-testable
 * authed surface is the "You in the graph" overlay, which renders once the user has context (> the You node).
 */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('a signed-in user with a considered park sees the "You in the graph" overlay', async ({ page }) => {
  await signUp(page);

  // Give the user some context: save a park → a CONSIDERED edge (written synchronously by /api/considered).
  await page.goto('/parks/grca');
  const savePost = page.waitForResponse(
    (r) => r.url().includes('/api/considered') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Save/ }).click();
  await savePost; // ensure the edge is persisted before /graph reads it server-side
  await expect(page.getByRole('button', { name: /Saved/ })).toBeVisible();

  // On /graph, the context graph now has > 1 node (You + the considered park) → the overlay controls render.
  await page.goto('/graph');
  const overlay = page.getByRole('group', { name: 'You in the graph' });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Just the world' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Me + the world' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Just me' })).toBeVisible();

  // Default view is "world"; switching to "Me + the world" flips the pressed state.
  await expect(overlay.getByRole('button', { name: 'Just the world' })).toHaveAttribute('aria-pressed', 'true');
  await overlay.getByRole('button', { name: 'Me + the world' }).click();
  await expect(overlay.getByRole('button', { name: 'Me + the world' })).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay.getByRole('button', { name: 'Just the world' })).toHaveAttribute('aria-pressed', 'false');
});

test('an anonymous user gets no "You in the graph" overlay', async ({ page }) => {
  // Anon has no context graph (only the implicit world), so the overlay must not render.
  await page.goto('/graph');
  await expect(page.getByTestId('nvl-graph')).toBeVisible();
  await expect(page.getByRole('group', { name: 'You in the graph' })).toHaveCount(0);
});
