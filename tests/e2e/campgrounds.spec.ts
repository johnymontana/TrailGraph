import { test, expect } from '@playwright/test';

/**
 * Multi-agency campgrounds finder + detail (Campgrounds feature). Uses the seeded fixtures: cg-canyon
 * (NPS, unified with RIDB facility 232449, 2 :Campsites incl. a tent/ADA site), cg-fishing-bridge (NPS),
 * and ridb:999001 (USFS dispersed, NEAR Yellowstone). Availability is gated OFF in e2e, so every chip
 * degrades to "Check on recreation.gov ↗" — the metadata + structure + the degrade are what we assert.
 */
test('campgrounds finder renders the filter form + seeded cards', async ({ page }) => {
  await page.goto('/campgrounds');
  await expect(page.getByRole('heading', { name: 'Find a campsite' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();
  await expect(page.getByText('Canyon Campground')).toBeVisible();
  await expect(page.getByText('Gallatin Dispersed Area')).toBeVisible();
});

test('campgrounds finder filters by agency (USFS → only the dispersed forest site)', async ({ page }) => {
  await page.goto('/campgrounds?agency=USFS');
  await expect(page.getByText('Gallatin Dispersed Area')).toBeVisible();
  await expect(page.getByText('Canyon Campground')).toHaveCount(0);
});

test('campgrounds finder filters by free booking + shows the Dispersed badge', async ({ page }) => {
  await page.goto('/campgrounds?booking=free');
  await expect(page.getByText('Gallatin Dispersed Area')).toBeVisible();
  // "Dispersed" (exact) matches only the card badge — not the lowercase subtitle or the campground name.
  await expect(page.getByText('Dispersed', { exact: true })).toBeVisible();
});

test('availability chip degrades to a recreation.gov deep link when the flag is off', async ({ page }) => {
  await page.goto('/campgrounds?from=2030-07-03&to=2030-07-05');
  // cg-canyon has a ridbId → an availability chip is shown, but with the endpoint disabled it must be the
  // honest degrade, never a positive (open/green) or false-negative (booked-out/red).
  await expect(page.getByText('Check on recreation.gov ↗').first()).toBeVisible();
});

test('campground card links to a site-level detail page with inventory + provenance', async ({ page }) => {
  await page.goto('/campgrounds');
  // Target the card's actual anchor by href (robust vs. clicking a text node mid-hydration — native anchor
  // navigation works even before React attaches).
  await page.locator('a[href="/campgrounds/cg-canyon"]').first().click();
  await expect(page).toHaveURL(/\/campgrounds\/cg-canyon/);
  await expect(page.getByRole('heading', { name: 'Canyon Campground' })).toBeVisible();
  // Site-level inventory (the differentiator) — the two seeded campsites.
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible();
  await expect(page.getByText('A012')).toBeVisible();
  await expect(page.getByText('B004')).toBeVisible();
  // Provenance reflects the NPS+RIDB unification, and the booking deep link is present.
  await expect(page.getByText(/merged from NPS \+ Recreation\.gov/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Book on Recreation\.gov/ })).toBeVisible();
});

test('Campgrounds appears in the primary nav', async ({ page }) => {
  await page.goto('/');
  // Desktop inline nav OR mobile drawer both render the LINKS array; assert the link exists in the DOM.
  await expect(page.getByRole('link', { name: 'Campgrounds' }).first()).toBeVisible();
});

test('comparison scorecard renders the radar + side-by-side fact table (Phase 3 viz)', async ({ page }) => {
  await page.goto('/campgrounds/compare?ids=cg-canyon,cg-fishing-bridge');
  await expect(page.getByRole('heading', { name: 'Compare campgrounds' })).toBeVisible();
  await expect(page.getByText('Canyon Campground vs Fishing Bridge RV Park')).toBeVisible();
  // The radar legend + the fact-table rows (over the structured inventory).
  await expect(page.getByText('Side-by-side')).toBeVisible();
  await expect(page.getByText('ADA sites')).toBeVisible();
  await expect(page.getByText('Dump station')).toBeVisible();
  await expect(page.getByText('Books out')).toBeVisible();
});

test('comparison page asks for 2+ campgrounds when given too few', async ({ page }) => {
  await page.goto('/campgrounds/compare?ids=cg-canyon');
  await expect(page.getByText('Pick 2–4 campgrounds to compare')).toBeVisible();
});

test('comparison handles 3 campgrounds incl. a colon-laden RIDB id', async ({ page }) => {
  await page.goto('/campgrounds/compare?ids=cg-canyon,cg-fishing-bridge,ridb:999001');
  await expect(page.getByRole('heading', { name: 'Compare campgrounds' })).toBeVisible();
  // The dispersed forest site (colon-laden id) is decoded + loaded into the comparison.
  await expect(page.getByText('Gallatin Dispersed Area').first()).toBeVisible();
});

test('detail page decodes a colon-laden RIDB id (prod dynamic-param gotcha) + dispersed copy', async ({ page }) => {
  // ridb:999001 → /campgrounds/ridb%3A999001 ; the route must decodeURIComponent before the graph lookup.
  await page.goto(`/campgrounds/${encodeURIComponent('ridb:999001')}`);
  await expect(page.getByRole('heading', { name: 'Gallatin Dispersed Area' })).toBeVisible();
  await expect(page.getByText('USFS Recreation Sites GIS')).toBeVisible(); // provenance by source, not "NPS"
  await expect(page.getByText(/dispersed camping: no reservation/i)).toBeVisible();
});

test('booking callout answers reservation-vs-first-come on the detail page (ADR-075)', async ({ page }) => {
  // cg-canyon: reservable=true, fcfs=false, 273 reservable sites → the reservation callout + ONE book CTA.
  await page.goto('/campgrounds/cg-canyon');
  await expect(page.getByText('Reservation required')).toBeVisible();
  await expect(page.getByText('273 reservable sites')).toBeVisible();
  await expect(page.getByRole('link', { name: /Book on Recreation\.gov/i })).toHaveCount(1);

  // ridb:999001 (USFS dispersed): fcfs=true → the first-come callout with the arrive-early guidance.
  await page.goto(`/campgrounds/${encodeURIComponent('ridb:999001')}`);
  await expect(page.getByText('First-come, first-served').first()).toBeVisible();
  await expect(page.getByText('No reservations — arrive early to claim a site.')).toBeVisible();
});

test('finder cards carry the booking badge instead of cryptic counts (ADR-075)', async ({ page }) => {
  await page.goto('/campgrounds');
  // Badge wording from BOOKING_BADGE_LABEL; the old "R273 · FCFS0" shorthand is gone.
  await expect(page.getByText('Reservation', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('First-come', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/R\d+ · FCFS\d+/)).toHaveCount(0);
});

test('detail page shows amenities, the verify box, and the (gated) Set-a-Camp-Watch affordance', async ({ page }) => {
  await page.goto('/campgrounds/cg-canyon');
  await expect(page.getByText('Wheelchair Accessible')).toBeVisible(); // amenity badge
  await expect(page.getByText('Verify before you book or tow')).toBeVisible(); // provenance/safety box
  await expect(page.getByText('Set a Camp Watch (soon)')).toBeVisible(); // gated affordance, not a dead link
});

test('search surfaces a Campgrounds section (fulltext, independent of embeddings)', async ({ page }) => {
  await page.goto('/search?q=canyon');
  await expect(page.getByRole('heading', { name: 'Campgrounds' })).toBeVisible();
  await expect(page.getByText('Canyon Campground').first()).toBeVisible();
});

test('finder filters by site type (tent → only the campground with a tent site)', async ({ page }) => {
  await page.goto('/campgrounds?siteType=tent');
  await expect(page.getByText('Canyon Campground')).toBeVisible();
  await expect(page.getByText('Gallatin Dispersed Area')).toHaveCount(0);
});

test('finder ADA checkbox narrows to accessible campgrounds', async ({ page }) => {
  await page.goto('/campgrounds?ada=1');
  await expect(page.getByText('Canyon Campground')).toBeVisible(); // has an ADA site + wheelchairAccessible
});

test('finder shows an honest empty state for an impossible filter combo', async ({ page }) => {
  await page.goto('/campgrounds?agency=NPS&booking=free');
  await expect(page.getByText('No campgrounds matched')).toBeVisible();
});
