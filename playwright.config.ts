import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running app backed by a seeded Neo4j (CI: ephemeral container + `pnpm seed:test`).
 * Covers the public surface end-to-end; authenticated trip CRUD is covered by integration tests
 * (a magic-link e2e is brittle — tracked as a follow-up via a gated test-login route).
 */
// Port is configurable (E2E_PORT) so the gate can run when the default dev port (3000) is busy.
const PORT = process.env.E2E_PORT || '3000';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // e2e runs against a production build (see `webServer` below), so routes are precompiled and parallel
  // workers don't contend on first-hit compiles. Keep CI at a single worker only to avoid Neo4j write
  // contention between the authed sign-up flows; locally, default parallelism.
  workers: process.env.CI ? 1 : undefined,
  // Neo4j round-trips can blow past Playwright's 30s default. Headroom.
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Software WebGL so MapLibre renders in headless CI.
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'] },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile project (ADR-076): Chromium-based emulation with iPhone-13 metrics, NOT `devices['iPhone 13']`
    // — that descriptor defaults to WebKit, but CI installs chromium only and the shared swiftshader
    // launchOptions above are Chromium-specific. Real-Safari fidelity waits for the Phase-2 gesture work.
    // Scoped to the plan-surface specs the shell affects; the shared openPane() helper makes them
    // layout-agnostic (it taps the tab bar only when it's visible).
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: ['**/plan-canvas.spec.ts', '**/plan-hardening.spec.ts', '**/home-origin.spec.ts', '**/plan-mobile.spec.ts', '**/plan-phase3.spec.ts'],
    },
  ],
  webServer: {
    // Run e2e against a PRODUCTION build, not `pnpm dev`. Dev mode emits Emotion class-hash hydration
    // *false positives* (React dev double-renders + on-demand style insertion) that the hydration gate
    // would otherwise flag even though production hydrates cleanly — see hydration.spec.ts. A prebuilt
    // server is the truest signal and removes first-hit route-compile latency.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    // Reuse only when explicitly requested (e.g., PLAYWRIGHT_REUSE_EXISTING_SERVER=1).
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1',
    // build + start headroom (build compiles the whole app before the server is ready).
    timeout: 300_000,
    // e2e needs no agent/AI Gateway — build/run Next without the eve service. E2E_TEST_MODE enables
    // email+password auth (read at runtime) so tests can sign in deterministically.
    env: { DISABLE_EVE: '1', E2E_TEST_MODE: '1' },
  },
});
