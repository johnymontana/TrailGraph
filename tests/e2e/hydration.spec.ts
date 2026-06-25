import { test, expect } from '@playwright/test';

/**
 * Regression gate for the recurring Chakra/Emotion hydration mismatch (QA R1–R3, §3.1). Fails if any
 * console error/warning or page error matches a hydration signature on the public routes. This is the
 * durable check that would have caught all three occurrences — keep it green.
 *
 * Note: dev surfaces hydration issues as console errors via React; for the truest signal run against a
 * production build (`next build && next start`). Public routes only (no auth needed).
 */
// `/plan` redirects anonymous users to `/signin` (ADR-038), so it also exercises the sign-in page.
// `/trails` carries the new client ThemeChips; every route exercises the mounted-gated nav account
// control (the highest-risk new hydration surface). `/parks/yell` (seeded) exercises the new motion
// client islands — the ParkHero (layoutId + scale-settle) and the global MotionConfig (ADR-044) — plus
// the astro "Tonight" stat; `/explore` now carries the RankPanel sliders (ADR-046).
// `/learn` + `/learn/lesson-yell-geology` are the public Ranger School catalog + syllabus (seeded course);
// `/learn/topic/Geology` is the public cross-park trail (design §13); `/learn/cert/<slug>` is the public
// certificate share page (a seeded fixture).
const ROUTES = ['/', '/explore', '/plan', '/me', '/map', '/graph', '/trails', '/learn', '/learn/lesson-yell-geology', '/learn/topic/Geology', '/learn/cert/test0123456789abcd', '/signin', '/parks/yell'];
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
    // `load` (not `networkidle`): the WebGL canvas pages (/graph, /map) keep network busy so networkidle
    // never settles. Load fires after scripts run → React hydration runs right after; we then give a
    // *bounded* networkidle window so the hydration-mismatch console error (if any) is captured.
    await page.goto(route, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    expect(problems, problems.join('\n')).toHaveLength(0);
  });
}
