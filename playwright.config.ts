import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running app backed by a seeded Neo4j (CI: ephemeral container + `pnpm seed:test`).
 * Covers the public surface end-to-end; authenticated trip CRUD is covered by integration tests
 * (a magic-link e2e is brittle — tracked as a follow-up via a gated test-login route).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Software WebGL so MapLibre renders in headless CI.
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // e2e needs no agent/AI Gateway — run Next without auto-starting the eve service. E2E_TEST_MODE
    // enables email+password auth so tests can sign in deterministically.
    env: { DISABLE_EVE: '1', E2E_TEST_MODE: '1' },
  },
});
