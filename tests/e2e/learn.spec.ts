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
  // Each lesson links to the player (the navigation fix); the link carries the player href.
  const lessonLink = page.getByRole('link', { name: /The Yellowstone Hotspot/ });
  await expect(lessonLink).toBeVisible();
  await expect(lessonLink).toHaveAttribute('href', /\/learn\/lesson-yell-geology\/lesson-yell-geology/);
});

test('catalog search filters to matching courses', async ({ page }) => {
  await page.goto('/learn?q=geology');
  await expect(page.getByRole('heading', { name: /Results for/i })).toBeVisible();
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
});

test('catalog search with no matches shows an empty state', async ({ page }) => {
  await page.goto('/learn?q=zzqqxxnomatchterm');
  await expect(page.getByText(/No courses match/i)).toBeVisible();
});

test('grade-band filter narrows the catalog (seed course is grade 6-8)', async ({ page }) => {
  await page.goto('/learn?grade=6-8');
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
  // the seed course is 6-8, so the K-2 band is empty
  await page.goto('/learn?grade=k-2');
  await expect(page.getByText(/No courses in this grade band/i)).toBeVisible();
});

test('catalog surfaces a cross-park trail chip (Geology spans yell + grca)', async ({ page }) => {
  await page.goto('/learn');
  await expect(page.getByRole('heading', { name: 'Cross-park trails', exact: true })).toBeVisible();
  const trailChip = page.getByRole('link', { name: /Geology · \d+ parks/ });
  await expect(trailChip).toBeVisible();
  await expect(trailChip).toHaveAttribute('href', '/learn/topic/Geology');
});

test('cross-park trail page lists the topic across both parks', async ({ page }) => {
  await page.goto('/learn/topic/Geology');
  await expect(page.getByRole('heading', { name: /Learn Geology across the parks/i })).toBeVisible();
  // Both seeded Geology courses are present, grouped by their park.
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
  await expect(page.getByText('Geology of the Grand Canyon')).toBeVisible();
  // Each course links to its syllabus.
  await expect(page.getByRole('link', { name: /Geology of Yellowstone/ })).toHaveAttribute('href', /\/learn\/lesson-yell-geology/);
});

test('a missing topic trail 404s', async ({ page }) => {
  const res = await page.goto('/learn/topic/NoSuchTopicZZZ');
  expect(res?.status()).toBe(404);
});

test('certificate page offers a copy-link button', async ({ page }) => {
  await page.goto('/learn/cert/test0123456789abcd');
  await expect(page.getByRole('button', { name: /Copy share link/i })).toBeVisible();
});

test('park page surfaces its Ranger School courses (discovery)', async ({ page }) => {
  await page.goto('/parks/yell');
  await expect(page.getByRole('heading', { name: 'Ranger School', exact: true })).toBeVisible();
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
});

test('the /me page shows a Ranger School learning section for a signed-in user', async ({ page }) => {
  await signUp(page);
  await page.goto('/me');
  // A fresh learner sees the section heading + a browse nudge (no progress yet).
  await expect(page.getByRole('heading', { name: 'Ranger School', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Browse courses/i })).toBeVisible();
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

test('lesson player resolves a URL-ENCODED (%3A) colon lesson id (production params regression)', async ({ page }) => {
  // Regression for the prod-only bug: next build hands dynamic params still percent-encoded, so the lesson
  // id "<plan>:m1:l1" arrives as %3A and must be decodeURIComponent'd before the graph lookup (else 404).
  await signUp(page);
  await page.goto('/learn/lesson-yell-geology/lesson-yell-geology%3Am1%3Al1');
  await expect(page.getByRole('heading', { name: 'The Yellowstone Hotspot', exact: true })).toBeVisible();
});

test('syllabus of a course with no lesson spine shows the not-decomposed message and no Start CTA', async ({ page }) => {
  // The seeded "Geology of the Grand Canyon" course is ABOUT grca with NO Module/Lesson spine.
  await page.goto('/learn/lesson-grca-geology');
  await expect(page.getByRole('heading', { name: /Geology of the Grand Canyon/i })).toBeVisible();
  await expect(page.getByText(/isn.t broken into lessons yet/i)).toBeVisible();
  // No "Start learning"/"Continue learning" CTA when there are no lessons to start.
  await expect(page.getByRole('button', { name: /Start learning|Continue learning/i })).toHaveCount(0);
});

test('catalog combines a grade-band filter with a search query', async ({ page }) => {
  // Both seed Geology courses match "geology"; the grade band must narrow to the 6–8 one (yell), excluding
  // the 9–12 Grand Canyon course.
  await page.goto('/learn?q=geology&grade=6-8');
  await expect(page.getByRole('heading', { name: /Results for/i })).toBeVisible();
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
  await expect(page.getByText('Geology of the Grand Canyon')).toHaveCount(0);
});

test('a signed-in learner sees the Your progress band (stat cards + badge shelf) on /learn', async ({ page }) => {
  await signUp(page);
  await page.goto('/learn');
  await expect(page.getByText(/Your progress/i)).toBeVisible();
  // The four StatCards render even at zero for a fresh learner.
  await expect(page.getByText('Lessons completed')).toBeVisible();
  await expect(page.getByText('Certificates')).toBeVisible();
  // The ranger badge shelf shows the (locked) taxonomy from migration 021 (adult-reframe heading).
  await expect(page.getByText(/Your ranger badges/i)).toBeVisible();
});

test('certificate Copy share link button switches to Copied! after a click', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-write']); // localhost is a secure context, so writeText resolves
  await page.goto('/learn/cert/test0123456789abcd');
  const btn = page.getByRole('button', { name: /Copy share link/i });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByRole('button', { name: /Copied!/i })).toBeVisible();
});

// --- Catalog filters/sort (adult reframe + Item 9) ---

test('catalog subject filter narrows to the subject and an unknown subject is empty', async ({ page }) => {
  // Both seed courses are subject "Earth Science".
  await page.goto('/learn?subject=Earth%20Science');
  await expect(page.getByText('Geology of Yellowstone')).toBeVisible();
  // A subject with no courses → the grounded empty state (never invented content).
  await page.goto('/learn?subject=Underwater%20Basket%20Weaving');
  await expect(page.getByText(/No courses/i)).toBeVisible();
});

test('catalog renders the subject + sort filter controls (no-JS GET form)', async ({ page }) => {
  await page.goto('/learn');
  // Native <select name=…> controls — precise locators (the label text "Subject" also appears as a Sort option).
  await expect(page.locator('select[name="subject"]')).toBeVisible();
  await expect(page.locator('select[name="sort"]')).toBeVisible();
  await expect(page.locator('select[name="subject"] option', { hasText: 'All subjects' })).toBeAttached();
  await expect(page.locator('select[name="sort"] option', { hasText: 'Most lessons' })).toBeAttached();
});

// --- Course syllabus header (Item 7) ---

test('course syllabus shows a park · subject · objective header', async ({ page }) => {
  await page.goto('/learn/lesson-yell-geology');
  await expect(page.getByText('Earth Science')).toBeVisible(); // subject badge
  await expect(page.getByText(/Explain how the Yellowstone hotspot/i)).toBeVisible(); // objective
  // Topic badges surfaced from RELATES_TO_TOPIC.
  await expect(page.getByText('Geology', { exact: true })).toBeVisible();
});

// --- Lesson player: the headline ID-leak fix + center-pane enrichment ---

test('lesson tutor chips show clean human text — NO leaked lessonId (the headline fix)', async ({ page }) => {
  await signUp(page);
  await page.goto(LESSON_URL);
  // The empty-state tutor prompts (chat is inert under DISABLE_EVE, so the chips render).
  await expect(page.getByText('Quiz me on this lesson', { exact: true })).toBeVisible();
  await expect(page.getByText(/Teach me "The Yellowstone Hotspot"/)).toBeVisible();
  // The OLD leak format ("…lessonId lesson-yell-geology:m1:l1") must be gone — no "lessonId" in the UI,
  // and the raw id never appears as visible text (it rides in Eve clientContext now).
  await expect(page.getByText(/lessonId/i)).toHaveCount(0);
  await expect(page.getByText(/:m1:l1/)).toHaveCount(0);
});

test('lesson center pane renders Key concepts + topics and drops the trip-planning disclaimer', async ({ page }) => {
  await signUp(page);
  await page.goto(LESSON_URL);
  // Decomposed module summary (was fetched but never rendered before).
  await expect(page.getByRole('heading', { name: 'Key concepts' })).toBeVisible();
  await expect(page.getByText(/How the Yellowstone hotspot built the caldera/i)).toBeVisible();
  // The out-of-place trip-safety copy is gone from lessons.
  await expect(page.getByText(/Openness and accessibility are reported by the park/i)).toHaveCount(0);
  // Self-guided audio is relabeled so it doesn't read as required lesson material (when the park has media).
  await expect(page.getByText(/Quiz me on this lesson/)).toBeVisible(); // sanity: shell rendered
});
