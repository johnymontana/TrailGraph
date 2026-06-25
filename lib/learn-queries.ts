import { readGraph } from './neo4j';
import { lessonPlanContext, type LessonPlanContext } from './queries';

/**
 * Ranger School progress/mastery reads (docs/RANGER_SCHOOL_DESIGN.md §6). Server-side graph computation
 * only — never model math (R6). Mirrors lib/queries.ts conventions: readGraph, toInteger for counts,
 * toFloat for ratios (integer division → 0 otherwise), toString for dates. A dedicated `getLearningMemory`
 * (rather than bloating lib/memory-graph.ts#getUserMemory, which feeds the NVL context graph) returns the
 * full learner state in ONE call for the tutor + the /learn dashboard.
 */

export interface LearningMemory {
  enrolled: { id: string; title: string }[];
  completedLessons: { id: string; title: string; score: number | null }[];
  struggling: { topic: string; confidence: number }[];
  mastery: { topic: string; score: number }[];
  badges: { id: string; label: string; tier: string }[];
  certificates: { lessonPlanId: string; courseTitle: string | null; shareSlug: string; score: number | null; issuedAt: string | null }[];
}

const EMPTY_LEARNING: LearningMemory = {
  enrolled: [],
  completedLessons: [],
  struggling: [],
  mastery: [],
  badges: [],
  certificates: [],
};

/** Full learner state in one multi-OPTIONAL-MATCH call (mirrors getUserMemory's chained-collect shape). */
export async function getLearningMemory(userId: string): Promise<LearningMemory> {
  const rows = await readGraph<LearningMemory>(
    `MATCH (u:User {userId: $userId})
     OPTIONAL MATCH (u)-[:ENROLLED_IN]->(lp:LessonPlan)
     WITH u, collect(DISTINCT {id: lp.id, title: lp.title}) AS enrolled
     OPTIONAL MATCH (u)-[cl:COMPLETED]->(l:Lesson)
     WITH u, enrolled, collect(DISTINCT {id: l.id, title: l.title, score: cl.score}) AS completedLessons
     OPTIONAL MATCH (u)-[sw:STRUGGLES_WITH]->(st:Topic)
     WITH u, enrolled, completedLessons, collect(DISTINCT {topic: st.name, confidence: sw.confidence}) AS struggling
     OPTIONAL MATCH (u)-[ms:MASTERY]->(mt:Topic)
     WITH u, enrolled, completedLessons, struggling, collect(DISTINCT {topic: mt.name, score: ms.score}) AS mastery
     OPTIONAL MATCH (u)-[:EARNED]->(b:Badge)
     WITH u, enrolled, completedLessons, struggling, mastery, collect(DISTINCT {id: b.id, label: b.label, tier: b.tier}) AS badges
     OPTIONAL MATCH (u)-[:ISSUED]->(c:Certificate)
     OPTIONAL MATCH (clp:LessonPlan {id: c.lessonPlanId})
     RETURN enrolled, completedLessons, struggling, mastery, badges,
            collect(DISTINCT {lessonPlanId: c.lessonPlanId,
                              courseTitle: clp.title,
                              shareSlug: c.shareSlug, score: c.score, issuedAt: toString(c.issuedAt)}) AS certificates`,
    { userId },
  );
  const r = rows[0];
  if (!r) return EMPTY_LEARNING; // no :User node yet (cold start)
  // OPTIONAL MATCH with no hit yields a {id:null,...} placeholder in the collected list — filter it out.
  return {
    enrolled: (r.enrolled ?? []).filter((x) => x.id),
    completedLessons: (r.completedLessons ?? []).filter((x) => x.id),
    struggling: (r.struggling ?? []).filter((x) => x.topic),
    mastery: (r.mastery ?? []).filter((x) => x.topic),
    badges: (r.badges ?? []).filter((x) => x.id),
    certificates: (r.certificates ?? []).filter((x) => x.lessonPlanId),
  };
}

export interface LearnDashboard {
  enrolled: number;
  completedLessons: number;
  badges: number;
}

/** Headline dashboard counts. CALL subqueries avoid a Cartesian product across the three aggregates. */
export async function getLearnDashboard(userId: string): Promise<LearnDashboard> {
  const rows = await readGraph<LearnDashboard>(
    `MATCH (u:User {userId: $userId})
     CALL { WITH u OPTIONAL MATCH (u)-[:ENROLLED_IN]->(lp:LessonPlan) RETURN count(DISTINCT lp) AS enrolled }
     CALL { WITH u OPTIONAL MATCH (u)-[:COMPLETED]->(l:Lesson) RETURN count(DISTINCT l) AS completedLessons }
     CALL { WITH u OPTIONAL MATCH (u)-[:EARNED]->(b:Badge) RETURN count(DISTINCT b) AS badges }
     RETURN toInteger(enrolled) AS enrolled, toInteger(completedLessons) AS completedLessons, toInteger(badges) AS badges`,
    { userId },
  );
  return rows[0] ?? { enrolled: 0, completedLessons: 0, badges: 0 };
}

export interface LessonPlanProgress {
  title: string;
  done: number;
  total: number;
  modules: {
    id: string;
    ordinal: number;
    title: string;
    lessons: { id: string; ordinal: number; title: string; completed: boolean }[];
  }[];
}

/**
 * Per-plan progress + the module/lesson spine for the course player, with each lesson flagged COMPLETED for
 * this user. Returns null if the lesson plan doesn't exist. `done`/`total` computed server-side over lessons
 * (COMPLETED lives on :Lesson, never :Module). Ordering applied here in TS (stable, avoids Cypher ORDER+collect quirks).
 */
export async function lessonPlanProgress(userId: string, lessonPlanId: string): Promise<LessonPlanProgress | null> {
  const rows = await readGraph<{ title: string; modules: LessonPlanProgress['modules'] }>(
    // Two SEPARATE OPTIONAL MATCHes (not a single chained path) so a module with zero lessons still
    // appears in the spine with lessons:[] rather than being atomically dropped by the chained match.
    `MATCH (lp:LessonPlan {id: $lessonPlanId})
     OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(m:Module)
     OPTIONAL MATCH (m)-[:CONTAINS_LESSON]->(l:Lesson)
     WITH lp, m, l,
          (l IS NOT NULL AND EXISTS { (:User {userId: $userId})-[:COMPLETED]->(l) }) AS completed
     WITH lp, m, collect(CASE WHEN l IS NULL THEN null
                              ELSE {id: l.id, ordinal: l.ordinal, title: l.title, completed: completed} END) AS lessons
     WITH lp, collect(CASE WHEN m IS NULL THEN null
                           ELSE {id: m.id, ordinal: m.ordinal, title: m.title,
                                 lessons: [x IN lessons WHERE x IS NOT NULL]} END) AS modules
     RETURN lp.title AS title, [x IN modules WHERE x IS NOT NULL] AS modules`,
    { userId, lessonPlanId },
  );
  if (!rows.length) return null;
  const modules = (rows[0].modules ?? [])
    .map((m) => ({ ...m, lessons: [...m.lessons].sort((a, b) => a.ordinal - b.ordinal) }))
    .sort((a, b) => a.ordinal - b.ordinal);
  const allLessons = modules.flatMap((m) => m.lessons);
  return { title: rows[0].title, done: allLessons.filter((l) => l.completed).length, total: allLessons.length, modules };
}

export interface LessonPlanHeader {
  subject: string | null;
  gradeLevel: string | null;
  objective: string | null;
  parkCode: string | null;
  parkName: string | null;
  topics: string[];
}

/**
 * Lightweight course header (park · subject · grade · objective · topics) for the syllabus page — a dedicated
 * read so the hot `lessonPlanProgress` query stays lean. Returns null if the lesson plan doesn't exist.
 */
export async function lessonPlanHeader(lessonPlanId: string): Promise<LessonPlanHeader | null> {
  const rows = await readGraph<LessonPlanHeader>(
    `MATCH (lp:LessonPlan {id: $lessonPlanId})
     OPTIONAL MATCH (lp)-[:ABOUT]->(p:Park)
     OPTIONAL MATCH (lp)-[:RELATES_TO_TOPIC]->(t:Topic)
     RETURN lp.subject AS subject, lp.gradeLevel AS gradeLevel, lp.objective AS objective,
            p.parkCode AS parkCode, p.fullName AS parkName,
            [x IN collect(DISTINCT t.name) WHERE x IS NOT NULL] AS topics`,
    { lessonPlanId },
  );
  return rows[0] ?? null;
}

export interface TopicMastery {
  topic: string;
  mastery: number; // rolling correctness 0..1 over the recent window
  attempts: number;
}

/**
 * Rolling correctness per topic over the recent ANSWERED window (default last 10), optionally scoped to one
 * lesson plan. Mastery = correct/total as a FLOAT (toFloat avoids integer division → 0). Drives the progress
 * dashboard + the tutor's difficulty adaptation.
 */
export async function masteryByTopic(userId: string, lessonPlanId?: string, windowSize = 10): Promise<TopicMastery[]> {
  return readGraph<TopicMastery>(
    `MATCH (u:User {userId: $userId})-[a:ANSWERED]->(q:QuizQuestion)-[:TESTS]->(t:Topic)
     WHERE $lessonPlanId IS NULL OR EXISTS {
       (:LessonPlan {id: $lessonPlanId})-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(:Lesson)-[:HAS_QUESTION]->(q)
     }
     WITH t, a ORDER BY a.at DESC
     WITH t, collect(a)[0..toInteger($windowSize)] AS recent
     RETURN t.name AS topic,
            toFloat(size([x IN recent WHERE x.correct])) / toFloat(size(recent)) AS mastery,
            size(recent) AS attempts
     ORDER BY topic ASC`,
    { userId, lessonPlanId: lessonPlanId ?? null, windowSize },
  );
}

// ---------------------------------------------------------------------------
// Phase 5: catalog + public certificate reads (for the /learn UI)
// ---------------------------------------------------------------------------

export interface LearnCourseCard {
  id: string;
  title: string;
  subject: string | null;
  gradeLevel: string | null;
  parkCode: string | null;
  parkName: string | null;
  lessonCount: number;
  decomposed: boolean; // has a Module/Lesson spine (i.e. teachable now)
}

/** Grade-band → [minGrade, maxGrade] for the catalog filter (K=0). */
export const GRADE_BANDS: Record<string, [number, number]> = {
  'k-2': [0, 2],
  '3-5': [3, 5],
  '6-8': [6, 8],
  '9-12': [9, 12],
};

/** Resolve a grade-band id to its [min,max] range, or null for an unknown/empty band. Pure. */
export function gradeBandRange(band: string | null | undefined): [number, number] | null {
  if (!band) return null;
  return GRADE_BANDS[band.toLowerCase()] ?? null;
}

/** Catalog sort options (whitelisted → safe to interpolate into ORDER BY; never user-supplied SQL/Cypher). */
export type CatalogSort = 'park' | 'grade' | 'subject' | 'lessons';
const CATALOG_SORTS: Record<CatalogSort, string> = {
  park: 'parkCode ASC, title ASC',
  grade: 'coalesce(lp.gradeMin, 99) ASC, title ASC',
  subject: 'coalesce(subject, "zzz") ASC, title ASC',
  lessons: 'lessonCount DESC, title ASC',
};
// Default keeps teachable (decomposed) courses ahead of catalog-only ones, then park + title.
const DEFAULT_CATALOG_SORT = 'decomposed DESC, parkCode ASC, title ASC';
function catalogSortClause(sort?: string): string {
  return (sort && CATALOG_SORTS[sort as CatalogSort]) || DEFAULT_CATALOG_SORT;
}

export interface CatalogOpts {
  subject?: string;
  sort?: CatalogSort;
  page?: number; // 0-based; SKIP = page * limit
}

/** Distinct subjects across lesson plans — the catalog's subject-filter facet. */
export async function subjectFacets(): Promise<string[]> {
  const rows = await readGraph<{ subject: string }>(
    `MATCH (lp:LessonPlan) WHERE lp.subject IS NOT NULL AND lp.subject <> ''
     RETURN DISTINCT lp.subject AS subject ORDER BY subject ASC`,
  );
  return rows.map((r) => r.subject);
}

/**
 * Catalog of courses (lesson plans) across parks for `/learn`, optionally filtered to a grade band + subject,
 * sorted (default decomposed-first then park+title), and paginated (0-based `page`). ~1,357 plans, so the
 * catalog page paginates rather than dumping everything.
 */
export async function learnCatalog(limit = 60, gradeBand?: string, opts: CatalogOpts = {}): Promise<LearnCourseCard[]> {
  const band = gradeBandRange(gradeBand);
  return readGraph<LearnCourseCard>(
    `MATCH (lp:LessonPlan)
     WHERE ($bandMin IS NULL OR (lp.gradeMin IS NOT NULL AND lp.gradeMax IS NOT NULL
                                 AND lp.gradeMin <= $bandMax AND lp.gradeMax >= $bandMin))
       AND ($subject IS NULL OR lp.subject = $subject)
     OPTIONAL MATCH (lp)-[:ABOUT]->(p:Park)
     OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(l:Lesson)
     WITH lp, p, count(DISTINCT l) AS lessonCount
     RETURN lp.id AS id, lp.title AS title, lp.subject AS subject, lp.gradeLevel AS gradeLevel,
            p.parkCode AS parkCode, p.fullName AS parkName,
            toInteger(lessonCount) AS lessonCount, lessonCount > 0 AS decomposed
     ORDER BY ${catalogSortClause(opts.sort)}
     SKIP toInteger($skip) LIMIT toInteger($limit)`,
    {
      limit,
      skip: Math.max(0, opts.page ?? 0) * limit,
      bandMin: band?.[0] ?? null,
      bandMax: band?.[1] ?? null,
      subject: opts.subject ?? null,
    },
  );
}

export interface CertificateShare {
  lessonPlanId: string;
  courseTitle: string | null;
  score: number | null;
  issuedAt: string | null;
}

/**
 * Public certificate lookup by its share slug (the slug is the only token — no auth, no PII). Returns null
 * when the slug doesn't exist (→ 404). `courseTitle` is null if the course was later removed (graceful).
 */
export async function certificateBySlug(slug: string): Promise<CertificateShare | null> {
  const rows = await readGraph<CertificateShare>(
    `MATCH (c:Certificate {shareSlug: $slug})
     OPTIONAL MATCH (lp:LessonPlan {id: c.lessonPlanId})
     RETURN c.lessonPlanId AS lessonPlanId, lp.title AS courseTitle, c.score AS score,
            toString(c.issuedAt) AS issuedAt`,
    { slug },
  );
  return rows[0] ?? null;
}

/**
 * Sanitize a user search string into a safe Lucene prefix query for the `lessonplan_fulltext` index:
 * lowercase, strip everything but letters/digits/spaces (no Lucene-operator injection), then prefix-wildcard
 * each term ("Yellowstone Geology!" → "yellowstone* geology*"). Returns '' for an empty/punctuation-only
 * query (caller falls back to the default catalog). Pure (unit-tested).
 */
export function toFulltextQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}*`)
    .join(' ');
}

/**
 * Search the course catalog by title/subject (fulltext, decomposed-first then by relevance). Falls back to
 * `learnCatalog` for an empty query, so the catalog page can use one code path. Essential at scale — there
 * are ~1,357 lesson plans.
 */
export async function searchCourses(
  rawQuery: string,
  opts: { limit?: number; gradeBand?: string } & CatalogOpts = {},
): Promise<LearnCourseCard[]> {
  const limit = opts.limit ?? 60;
  const ft = toFulltextQuery(rawQuery);
  // Empty query → the catalog path (one code path), forwarding all facets/sort/page.
  if (!ft) return learnCatalog(limit, opts.gradeBand, opts);
  const band = gradeBandRange(opts.gradeBand);
  // A typed sort overrides relevance; default keeps relevance (decomposed-first then score).
  const order = opts.sort ? catalogSortClause(opts.sort) : 'decomposed DESC, score DESC';
  return readGraph<LearnCourseCard>(
    `CALL db.index.fulltext.queryNodes('lessonplan_fulltext', $ft) YIELD node AS lp, score
     WHERE ($bandMin IS NULL OR (lp.gradeMin IS NOT NULL AND lp.gradeMax IS NOT NULL
                                 AND lp.gradeMin <= $bandMax AND lp.gradeMax >= $bandMin))
       AND ($subject IS NULL OR lp.subject = $subject)
     OPTIONAL MATCH (lp)-[:ABOUT]->(p:Park)
     OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(l:Lesson)
     WITH lp, p, score, count(DISTINCT l) AS lessonCount
     RETURN lp.id AS id, lp.title AS title, lp.subject AS subject, lp.gradeLevel AS gradeLevel,
            p.parkCode AS parkCode, p.fullName AS parkName,
            toInteger(lessonCount) AS lessonCount, lessonCount > 0 AS decomposed
     ORDER BY ${order}
     SKIP toInteger($skip) LIMIT toInteger($limit)`,
    {
      ft,
      limit,
      skip: Math.max(0, opts.page ?? 0) * limit,
      bandMin: band?.[0] ?? null,
      bandMax: band?.[1] ?? null,
      subject: opts.subject ?? null,
    },
  );
}

// ---------------------------------------------------------------------------
// Cross-park learning trails (design §13) — a topic taught across multiple parks.
// Query-time (like lib/queries.ts#thematicTrail), reusing (:Topic)<-[:RELATES_TO_TOPIC]-(:LessonPlan)-[:ABOUT]->(:Park).
// ---------------------------------------------------------------------------

export interface CrossParkTopic {
  topic: string;
  parkCount: number;
  courseCount: number;
}

/** Topics taught across ≥2 parks — the discoverable cross-park trails. Sorted by reach then breadth. */
export async function crossParkTopics(limit = 12): Promise<CrossParkTopic[]> {
  return readGraph<CrossParkTopic>(
    `MATCH (t:Topic)<-[:RELATES_TO_TOPIC]-(lp:LessonPlan)-[:ABOUT]->(p:Park)
     WITH t, count(DISTINCT p) AS parkCount, count(DISTINCT lp) AS courseCount
     WHERE parkCount >= 2
     RETURN t.name AS topic, toInteger(parkCount) AS parkCount, toInteger(courseCount) AS courseCount
     ORDER BY parkCount DESC, courseCount DESC, topic ASC
     LIMIT toInteger($limit)`,
    { limit },
  );
}

export interface TrailCourse {
  id: string;
  title: string;
  subject: string | null;
  gradeLevel: string | null;
  gradeMin: number | null;
  parkCode: string | null;
  parkName: string | null;
  lessonCount: number;
  decomposed: boolean;
}

/**
 * The courses on a topic across every park that teaches it, ordered by grade band then park — the
 * "learn Volcanoes across Yellowstone, Hawai'i Volcanoes, and Lassen" trail. Returns [] for an
 * unknown/empty topic.
 */
export async function learningTrailForTopic(topicName: string): Promise<TrailCourse[]> {
  return readGraph<TrailCourse>(
    `MATCH (t:Topic {name: $topic})<-[:RELATES_TO_TOPIC]-(lp:LessonPlan)-[:ABOUT]->(p:Park)
     OPTIONAL MATCH (lp)-[:TARGETS]->(gb:GradeBand)
     OPTIONAL MATCH (lp)-[:CONTAINS_MODULE]->(:Module)-[:CONTAINS_LESSON]->(l:Lesson)
     WITH lp, p, gb, count(DISTINCT l) AS lessonCount
     RETURN lp.id AS id, lp.title AS title, lp.subject AS subject, lp.gradeLevel AS gradeLevel,
            gb.min AS gradeMin, p.parkCode AS parkCode, p.fullName AS parkName,
            toInteger(lessonCount) AS lessonCount, lessonCount > 0 AS decomposed
     ORDER BY coalesce(gb.min, 99) ASC, p.fullName ASC, title ASC`,
    { topic: topicName },
  );
}

// ---------------------------------------------------------------------------
// Phase 4: quiz-serving + lesson-content reads (anti-cheat: correctId is server-only)
// ---------------------------------------------------------------------------

/** Map per-topic mastery → an adaptive quiz difficulty (low mastery → easy, high → hard). Pure. */
export function quizDifficultyForMastery(mastery: number | null | undefined): 'easy' | 'medium' | 'hard' {
  if (mastery == null) return 'easy'; // unseen topic → start gentle
  if (mastery < 0.6) return 'easy';
  if (mastery <= 0.8) return 'medium';
  return 'hard';
}

export interface ClientQuiz {
  id: string;
  stem: string;
  choices: { id: string; label: string }[]; // NO correctId — anti-cheat
  difficulty: string;
  lessonId: string;
}

function parseChoices(raw: string | null): { id: string; label: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { id: string; label: string }[];
    return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Client-facing quiz read: stem + parsed choices + difficulty + lessonId, **never `correctId`/`rationale`**
 * (anti-cheat — grading is server-only). Returns null if the quiz is missing or its choices are unparseable.
 */
export async function quizForClient(quizId: string): Promise<ClientQuiz | null> {
  const rows = await readGraph<{ id: string; stem: string; choices: string; difficulty: string; lessonId: string }>(
    `MATCH (q:QuizQuestion {id: $quizId})
     RETURN q.id AS id, q.stem AS stem, q.choices AS choices, q.difficulty AS difficulty, q.lessonId AS lessonId`,
    { quizId },
  );
  if (!rows.length) return null;
  const choices = parseChoices(rows[0].choices);
  if (!choices.length) return null;
  return { id: rows[0].id, stem: rows[0].stem, choices, difficulty: rows[0].difficulty, lessonId: rows[0].lessonId };
}

export interface QuizGradeData {
  correctId: string;
  rationale: string | null;
  difficulty: string;
  lessonId: string;
  topics: string[]; // all TESTS topics (empty until deriveLessonTopics grounds the course in its park's topics)
  choices: { id: string; label: string }[]; // parsed — lets grade_answer map ids → human labels for the feedback card
}

/** SERVER-ONLY grading ground truth (`correctId` + rationale + choices + every TESTS topic). Never sent to the
 * client pre-answer; `choices` is fine post-grade (the feedback card reveals the correct answer's label). */
export async function quizGradeData(quizId: string): Promise<QuizGradeData | null> {
  const rows = await readGraph<{
    correctId: string;
    rationale: string | null;
    difficulty: string;
    lessonId: string;
    topics: string[];
    choices: string | null;
  }>(
    `MATCH (q:QuizQuestion {id: $quizId})
     OPTIONAL MATCH (q)-[:TESTS]->(t:Topic)
     RETURN q.correctId AS correctId, q.rationale AS rationale, q.difficulty AS difficulty,
            q.lessonId AS lessonId, q.choices AS choices, [x IN collect(DISTINCT t.name) WHERE x IS NOT NULL] AS topics`,
    { quizId },
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    correctId: r.correctId,
    rationale: r.rationale,
    difficulty: r.difficulty,
    lessonId: r.lessonId,
    topics: r.topics,
    choices: parseChoices(r.choices),
  };
}

/**
 * Pick a cached quiz for a lesson, preferring the given difficulty and SKIPPING `excludeIds` (recently-served
 * questions) so re-quizzing a lesson serves a fresh item / climbs difficulty rather than repeating. Falls back
 * to any non-excluded quiz so a learner is never stuck. Client-safe (no correctId).
 */
export async function pickQuizForLesson(lessonId: string, difficulty?: string, excludeIds: string[] = []): Promise<ClientQuiz | null> {
  const rows = await readGraph<{ id: string; stem: string; choices: string; difficulty: string }>(
    `MATCH (l:Lesson {id: $lessonId})-[:HAS_QUESTION]->(q:QuizQuestion)
     WHERE NOT q.id IN $excludeIds
     RETURN q.id AS id, q.stem AS stem, q.choices AS choices, q.difficulty AS difficulty
     ORDER BY CASE WHEN $difficulty IS NOT NULL AND q.difficulty = $difficulty THEN 0 ELSE 1 END, q.ordinal ASC
     LIMIT 1`,
    { lessonId, difficulty: difficulty ?? null, excludeIds },
  );
  if (!rows.length) return null;
  const choices = parseChoices(rows[0].choices);
  if (!choices.length) return null;
  return { id: rows[0].id, stem: rows[0].stem, choices, difficulty: rows[0].difficulty, lessonId };
}

/**
 * The quiz ids a learner most-recently ANSWERED for a lesson (newest first) — fed to `pickQuizForLesson` as
 * `excludeIds` so the tutor doesn't immediately re-serve a question they just answered.
 */
export async function recentQuizIdsForLesson(userId: string, lessonId: string, limit = 5): Promise<string[]> {
  const rows = await readGraph<{ id: string }>(
    `MATCH (:User {userId: $userId})-[a:ANSWERED]->(q:QuizQuestion)<-[:HAS_QUESTION]-(:Lesson {id: $lessonId})
     RETURN q.id AS id ORDER BY a.at DESC LIMIT toInteger($limit)`,
    { userId, lessonId, limit },
  );
  return rows.map((r) => r.id);
}

export interface LessonContent {
  lesson: { id: string; ordinal: number; title: string; durationMin: number | null };
  module: { id: string; ordinal: number; title: string; summary: string | null };
  lessonPlanId: string;
  context: LessonPlanContext | null; // park + media (F6) + events (F4) + open-window (F1), via the anchor park
}

/**
 * Full teaching context for a lesson: the lesson + its parent module + the park-grounded
 * media/events/open-window (reusing `lessonPlanContext`). Returns null if the lesson doesn't exist.
 */
export async function lessonContent(
  lessonId: string,
  window: { start: string | null; end: string | null } = { start: null, end: null },
): Promise<LessonContent | null> {
  const rows = await readGraph<{
    lessonId: string;
    lessonOrdinal: number;
    lessonTitle: string;
    durationMin: number | null;
    moduleId: string;
    moduleOrdinal: number;
    moduleTitle: string;
    moduleSummary: string | null;
    lessonPlanId: string;
  }>(
    `MATCH (l:Lesson {id: $lessonId})
     OPTIONAL MATCH (m:Module)-[:CONTAINS_LESSON]->(l)
     OPTIONAL MATCH (lp:LessonPlan)-[:CONTAINS_MODULE]->(m)
     RETURN l.id AS lessonId, l.ordinal AS lessonOrdinal, l.title AS lessonTitle, l.durationMin AS durationMin,
            m.id AS moduleId, m.ordinal AS moduleOrdinal, m.title AS moduleTitle, m.summary AS moduleSummary,
            lp.id AS lessonPlanId`,
    { lessonId },
  );
  if (!rows.length) return null;
  const r = rows[0];
  const context = r.lessonPlanId ? await lessonPlanContext(r.lessonPlanId, window) : null;
  return {
    lesson: { id: r.lessonId, ordinal: r.lessonOrdinal, title: r.lessonTitle, durationMin: r.durationMin },
    module: { id: r.moduleId, ordinal: r.moduleOrdinal, title: r.moduleTitle, summary: r.moduleSummary },
    lessonPlanId: r.lessonPlanId,
    context,
  };
}
