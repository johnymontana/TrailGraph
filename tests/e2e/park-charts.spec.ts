import { test, expect } from '@playwright/test';

/**
 * Park-detail data-viz (Chakra charts). Regression guard for the blank-chart bug: `@chakra-ui/charts`
 * `Chart.Root` has no ResponsiveContainer, so the recharts element needs `responsive` (recharts 3.8.1)
 * or it sizes to 0. We assert the chart's `<svg>` actually has non-zero dimensions — not just that the
 * caption renders. Assumes the seeded `glac` fixture (has 12-month monthlyVisits).
 */
test('visitation chart renders with a non-zero SVG (not blank)', async ({ page }) => {
  await page.goto('/parks/glac');
  await expect(page.getByText(/Monthly recreation visits/i)).toBeVisible();
  const svg = page.locator('svg.recharts-surface').first();
  await expect(svg).toBeVisible();
  const box = await svg.boundingBox();
  expect(box, 'recharts svg has no bounding box').not.toBeNull();
  expect(box!.height, 'chart collapsed to zero height (missing `responsive`)').toBeGreaterThan(60);
  expect(box!.width).toBeGreaterThan(120);
  // The area path actually drew.
  expect(await page.locator('.recharts-area-area, .recharts-area').count()).toBeGreaterThan(0);
});

test('the "By the numbers" chart suite renders with real (non-zero) charts', async ({ page }) => {
  await page.goto('/parks/glac');

  // Section + the universal fingerprint radar.
  await expect(page.getByRole('heading', { name: 'By the numbers' })).toBeVisible();
  await expect(page.getByText('Park fingerprint')).toBeVisible();
  await expect(page.locator('.recharts-polar-grid').first()).toBeVisible(); // radar drew

  // Best-time calendar (12 month cells) — unique caption avoids the "(fewer crowds)" text line.
  await expect(page.getByText(/Relative crowds by month/)).toBeVisible();

  // Dark-sky gauge — unique caption; glac is Bortle 2 in the seed.
  await expect(page.getByText(/darker \(lower Bortle\) fills the dial/)).toBeVisible();
  await expect(page.getByText(/Bortle 2/).first()).toBeVisible();

  // Several real charts on the page, each with a sized SVG.
  const svgs = page.locator('svg.recharts-surface');
  expect(await svgs.count()).toBeGreaterThanOrEqual(2);
  const box = await svgs.first().boundingBox();
  expect(box!.height).toBeGreaterThan(40);
});
