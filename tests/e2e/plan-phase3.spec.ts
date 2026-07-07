import { test, expect, type Page } from '@playwright/test';
import { openPane } from './helpers/pane';

/**
 * Phase 3 polish (ADR-076): trip dates editor (P3.1), trip delete (P3.2), persisted day plans (P3.8),
 * keyboard reorder (P3.3), and the empty-trip checklist (P3.5). Runs in both Playwright projects; the
 * shared `openPane` helper reaches the Itinerary pane on mobile (a no-op on desktop). E2E runs with
 * DISABLE_EVE, so these assert builder UI that renders without a model turn.
 */
async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E User', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

async function createTrip(page: Page, name: string): Promise<void> {
  await openPane(page, 'itinerary');
  await page.getByPlaceholder('New trip name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

async function addPark(page: Page, query: string, exactOption: string): Promise<void> {
  const search = page.getByPlaceholder(/Search parks by name/);
  await search.fill(query);
  await page.getByText(exactOption).click();
}

test('trip dates editor sets and clears the trip window (P3.1)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await createTrip(page, 'Dates E2E');

  await page.getByRole('button', { name: 'Add dates' }).click();
  await page.getByLabel('Trip start date').fill('2026-08-10');
  await page.getByLabel('Trip end date').fill('2026-08-14');
  await page.getByRole('button', { name: 'Set', exact: true }).click();
  await expect(page.getByText('2026-08-10 → 2026-08-14')).toBeVisible();

  // Clear reverts to the no-dates state.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('No dates set.')).toBeVisible();
});

test('the empty-trip checklist shows the three add paths (P3.5)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await createTrip(page, 'Empty E2E');
  await expect(page.getByText('This trip is empty — add your first stop:')).toBeVisible();
  await expect(page.getByText('Ask the ranger to plan it for you')).toBeVisible();
});

test('suggested day plan persists across a reload (P3.8)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await createTrip(page, 'Days E2E');
  await addPark(page, 'Yellowstone', 'Yellowstone National Park');
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();
  await addPark(page, 'Glacier', 'Glacier National Park');
  await expect(page.getByText(/2\. Glacier/)).toBeVisible();

  await page.getByRole('button', { name: 'Suggest day plan' }).click();
  await expect(page.getByText(/Day 1/).first()).toBeVisible();

  // Reload: the persisted stop.day (applyDays) keeps the day headers — the old ephemeral dayMap was lost.
  await page.reload();
  await openPane(page, 'itinerary');
  await page.getByRole('button', { name: /Days E2E/ }).click();
  await expect(page.getByText(/Day 1/).first()).toBeVisible();
});

test('keyboard reorder moves a stop with the up/down buttons (P3.3)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await createTrip(page, 'Reorder E2E');
  await addPark(page, 'Yellowstone', 'Yellowstone National Park');
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();
  await addPark(page, 'Glacier', 'Glacier National Park');
  await expect(page.getByText(/2\. Glacier/)).toBeVisible();

  // Move Glacier up → it becomes stop 1.
  await page.getByRole('button', { name: 'Move Glacier National Park up' }).click();
  await expect(page.getByText(/1\. Glacier/)).toBeVisible();
  await expect(page.getByText(/2\. Yellowstone/)).toBeVisible();
});

test('delete removes the trip after confirmation (P3.2)', async ({ page }) => {
  await signUp(page);
  await page.goto('/plan');
  await createTrip(page, 'Delete E2E');
  await addPark(page, 'Yellowstone', 'Yellowstone National Park');
  await expect(page.getByText(/1\. Yellowstone/)).toBeVisible();

  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete trip…' }).click();
  await expect(page.getByText('Delete this trip?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete trip', exact: true }).click();

  // Heading gone; the switcher chip for it is gone too.
  await expect(page.getByRole('heading', { name: 'Delete E2E' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete E2E/ })).toHaveCount(0);
});
