import { test, expect, type Page } from '@playwright/test';

/**
 * Ranger School /learn surfaces. The catalog/syllabus/certificate routes are public (no auth) and render
 * from the seeded fixtures (scripts/seed-test-data.ts): the "Geology of Yellowstone" course with its
 * Module ("Hotspot & Caldera") → Lesson ("The Yellowstone Hotspot") spine, and a Certificate with the
 * fixed shareSlug "test0123456789abcd". The lesson player (Phase 5.1) is auth-gated. Authed flows use the
 * E2E_TEST_MODE email/password sign-up; the tutor chat is inert here (DISABLE_EVE=1) but the shell renders.
 */
const LESSON_URL = '/learn/lesson-yell-geology/lesson-yell-geology:m1:l1';

async function signUp(page: Page): Promise<void> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const res = await page.request.post('/api/auth/sign-up/email', {
    data: { name: 'E2E Learner', email, password: 'test-password-123' },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
}

test('learn catalog lists a seeded course', async ({ page }) => {
  await page.goto('/learn');
  await expect(page.getByRole('heading', { name: /Learn the parks/i })).toBeVisible();
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
});

test('course syllabus shows the module + lesson spine', async ({ page }) => {
  await page.goto('/learn/lesson-yell-geology');
  await expect(page.getByRole('heading', { name: /Geology of Yellowstone/i })).toBeVisible();
  await expect(page.getByText(/Hotspot & Caldera/)).toBeVisible();
  await expect(page.getByText(/The Yellowstone Hotspot/)).toBeVisible();
});

test('certificate share page renders a seeded certificate (public, no auth)', async ({ page }) => {
  await page.goto('/learn/cert/test0123456789abcd');
  await expect(page.getByRole('heading', { name: /Certificate of Completion/i })).toBeVisible();
  await expect(page.getByText(/Geology of Yellowstone/)).toBeVisible();
});

test('a missing certificate slug 404s', async ({ page }) => {
  const res = await page.goto('/learn/cert/definitely-not-a-real-slug');
  expect(res?.status()).toBe(404);
});

test('lesson player redirects anonymous users to sign-in (auth-gated)', async ({ page }) => {
  await page.goto(LESSON_URL);
  await expect(page).toHaveURL(/\/signin/);
});

test('a signed-in learner sees the lesson player shell + content', async ({ page }) => {
  await signUp(page);
  await page.goto(LESSON_URL);
  // Center pane renders the lesson (RSC content — independent of the inert chat under DISABLE_EVE).
  // Exact match targets the visible h2 only; the srOnly h1 is "<lesson> — <course>" (stays in the a11y
  // tree, so an unanchored regex would strict-mode-match both headings).
  await expect(page.getByRole('heading', { name: 'The Yellowstone Hotspot', exact: true })).toBeVisible();
  // Right pane: the lesson-seeded tutor chat header.
  await expect(page.getByText(/Ranger · your tutor/)).toBeVisible();
});
