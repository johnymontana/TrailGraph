// Bonus items (plan §5 bonuses): :LessonPlan (educator content), queryable contacts (props on :Park,
// no constraint), materialized SHARES_TOPIC/SHARES_ACTIVITY (edge props only, no index). Idempotent.
// (The :Webcam graph node was dropped — webcams use the runtime conditions path; see migration 020.)

CREATE CONSTRAINT lessonplan_id IF NOT EXISTS FOR (l:LessonPlan) REQUIRE l.id IS UNIQUE;
CREATE FULLTEXT INDEX lessonplan_fulltext IF NOT EXISTS FOR (l:LessonPlan) ON EACH [l.title, l.subject];
