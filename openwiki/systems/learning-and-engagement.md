---
type: learning and engagement system
title: Ranger School, personal engagement, and notifications
description: Lesson-plan ingestion and grounded course graph, learner progress, personal hub/onboarding, collective signals, readings, and digest/inbox delivery.
tags: [learning, engagement, notifications, personalization]
---
# Ranger School, personal engagement, and notifications

Ranger School is a persisted learning graph, not per-turn generated tutoring. `app/learn/` supplies catalog, lesson-plan, lesson, topic and certificate routes; `lib/learn-queries.ts` supplies read models; agent tutor tools consume the same data. Its source spine is `LessonPlan -[:CONTAINS_MODULE]-> Module -[:CONTAINS_LESSON]-> Lesson -[:HAS_QUESTION]-> QuizQuestion` (migration `021_ranger_school.cypher`).

## Ingest, decomposition, and progress

NPS lesson-plan upsert extracts grade ranges, subject/objective, standards and park links. Optional `DECOMPOSE_LESSONPLANS=1` runs `decompose-lessons.ts`: it hashes source plus version, calls structured generation, validates it with `buildCourseSpine()`, persists deterministic IDs, and only grounds quiz topics in already existing lesson-plan/park topics. It preserves learner `ANSWERED` history when pruning superseded questions. A shrinking regeneration may retain obsolete module/lesson nodes deliberately because automatic deletion could destroy progress.

Slow sync runs feature-gated decomposition before topic derivation, because generated quizzes can then receive only grounded existing topics. Deterministic content-hashed module/lesson/quiz IDs make rerun safe; malformed generated sections/questions are dropped, and quiz IDs include difficulty so one lesson/difficulty/version bank is unique. `derive-lesson-topics.ts` finds existing park topics matching title/subject with whole-word-like matching and uses Topic IDs; it does not invent model-guessed topics. `getLearningMemory`, `lessonPlanProgress` and `masteryByTopic` filter OPTIONAL MATCH null artifacts, preserve empty modules and calculate recent-answer float correctness. `learnCatalog()` uses a whitelisted sort clause.

`/api/learn/transcript/[lessonId]` URL-decodes the lesson key and derives user identity from session. Anonymous GET has no personal transcript; POST requires session and writes one opaque JSON payload by user/lesson composite key. `getTutorTranscript()` treats malformed stored JSON as an empty fallback, not a route failure. `qualifyingBadgeIds()` applies milestone thresholds, excludes already-earned badges, and `awardEarnedBadges()` persists idempotent awards. Test transcript scope/fallback in `learn-transcript.test.ts`, badges in `learn-badges.test.ts`, and generated-course identity/drop behavior in `sync/decompose-lessons.test.ts`.

## Personal and notification subsystems

`/me` exposes user graph memory and deletion/tuning operations; onboarding gathers initial preferences. Home is stored through `/api/me/home`; personal endpoints must derive session identity, like ranger tools. `lib/collective.ts` supplies aggregate behavior, never raw other-user memory. `lib/readings.ts` stores sky readings; `/api/readings` is its surface. `lib/digest.ts` combines watches/conditions into inbox/email content; `/api/digests` cron fans out. `/api/inbox`, `/api/usage`, `/api/considered`, `/api/explain`, rank and unsubscribe complete the engagement API family.

Notification delivery is best-effort: opt-in/configured email determines sending, provider failures are isolated so one user/provider does not stop fan-out, and watched/digest state remains graph-owned. Camp-specific watches are documented in [campgrounds](campgrounds.md); cron/auth and cleanup are in [operations](../operations-and-testing.md).

Validate transformation and course safety with `sync/decompose-lessons.test.ts`, `sync/derive-lesson-topics.test.ts`, `learn-queries.test.ts`, `learn-badges.test.ts`; use `tests/integration/ranger-school.itest.ts`, collective/digest integration tests and `tests/e2e/learn.spec.ts`. When adding learner state, define model relationship, owner-scoped mutation, read-model null behavior and whether it appears in agent learning memory.