import { test, expect } from '@playwright/test';

/**
 * Regression gate for the recurring Chakra/Emotion hydration mismatch (QA R1–R3, §3.1). Fails if any
 * console error/warning or page error matches a hydration signature on the public routes. This is the
 * durable check that would have caught all three occurrences — keep it green.
 *
 * Note: dev surfaces hydration issues as console errors via React; for the truest signal run against a
 * production build (`next build && next start`). Public routes only (no auth needed).
 */
const ROUTES = ['/', '/explore', '/plan', '/me', '/map', '/graph'];
const HYDRATION_RX = /hydrat|did not match|text content does not match|tree hydrated|css-\w+/i;

for (const route of ROUTES) {
  test(`no hydration errors on ${route}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && HYDRATION_RX.test(m.text())) {
        problems.push(`[console.${m.type()}] ${m.text()}`);
      }
    });
    page.on('pageerror', (e) => {
      if (HYDRATION_RX.test(e.message)) problems.push(`[pageerror] ${e.message}`);
    });
    await page.goto(route, { waitUntil: 'networkidle' });
    expect(problems, problems.join('\n')).toHaveLength(0);
  });
}
