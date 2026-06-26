import { test, expect } from '@playwright/test';

/**
 * Scrollytelling 3D tour (#11B). Ferdinand Hayden is a seeded :Person ASSOCIATED_WITH yell + glac, so his
 * trail has 2 mappable stops. The map degrades to a flat fly with no terrain DEM configured — the structure
 * (sticky map + narrative panels + active-stop overlay) is what we assert (not the WebGL camera).
 */
test.describe('scrollytelling 3D tour (#11B)', () => {
  test('renders the sticky map + narrative panels for a seeded person trail', async ({ page }) => {
    await page.goto('/trails/tour?person=Ferdinand Hayden', { waitUntil: 'load' });
    await expect(page.getByRole('application')).toBeVisible(); // the sticky tour map
    await expect(page.getByText('In the footsteps of')).toBeVisible();
    await expect(page.getByText(/Stop 1 of \d+/)).toBeVisible();
    // First narrative panel = a park on Hayden's trail (yell + glac), with cross-links.
    await expect(page.getByRole('heading', { name: /Yellowstone|Glacier/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Explore park/ }).first()).toBeVisible();
  });

  test('shows an empty state for a theme with no mappable parks', async ({ page }) => {
    await page.goto('/trails/tour?topic=NoSuchTopicXYZ');
    await expect(page.getByText(/no mappable parks|Pick a person or topic/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse thematic trails/ })).toBeVisible();
  });

  test('the /trails page links into the 3D tour', async ({ page }) => {
    await page.goto('/trails?person=Ferdinand Hayden');
    const tour = page.getByRole('link', { name: /Fly the 3D tour/ });
    await expect(tour).toBeVisible();
    await expect(tour).toHaveAttribute('href', /\/trails\/tour\?person=/);
  });
});
