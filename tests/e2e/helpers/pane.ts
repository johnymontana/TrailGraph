import type { Page } from '@playwright/test';

/**
 * Switch to a /plan pane on the mobile shell (ADR-076); a NO-OP on desktop, where all three panes are
 * simultaneously visible and the tab bar is display:none. Lets one spec source serve both Playwright
 * projects — sprinkle `openPane` before assertions that target a pane the mobile default (Itinerary)
 * hides, instead of forking the spec per layout.
 */
export async function openPane(page: Page, pane: 'map' | 'itinerary' | 'ranger'): Promise<void> {
  const bar = page.getByTestId('plan-tab-bar');
  if (!(await bar.isVisible().catch(() => false))) return;
  // Accessible names carry state suffixes ("Itinerary, 2 stops" / "Ranger, new activity") — match the prefix.
  const name = { map: /^Map/, itinerary: /^Itinerary/, ranger: /^Ranger/ }[pane];
  await bar.getByRole('button', { name }).click();
}

/** Whether this run is the mobile (tabbed) layout — for skipping tab-bar-specific tests on desktop. */
export function isMobileViewport(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}
