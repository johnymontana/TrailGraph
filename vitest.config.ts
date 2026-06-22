import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *  - `unit`        — pure logic, no I/O (mocks the DB/network). Runs everywhere, fast.
 *  - `integration` — real Neo4j (tests/integration/*.itest.ts). Self-skips when no DB is reachable
 *                    (see tests/integration/db.ts); CI provides a Neo4j service container.
 *
 * Playwright e2e lives separately (playwright.config.ts), not under vitest.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['lib/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          // `.eve/dev-runtime/snapshots/**` holds the Eve dev server's copies of source files
          // (incl. *.test.ts); never collect those — only the canonical tree.
          exclude: ['**/node_modules/**', '**/.eve/**', '**/dist/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.itest.ts'],
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false, // share one DB; avoid cross-test interference
        },
      },
    ],
  },
});
