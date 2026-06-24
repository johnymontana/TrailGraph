// Bonus items (plan §5 bonuses): :Webcam node, :LessonPlan, queryable contacts (props on :Park, no
// constraint), materialized SHARES_TOPIC/SHARES_ACTIVITY (edge props only, no index). Idempotent.

CREATE CONSTRAINT webcam_id IF NOT EXISTS FOR (w:Webcam) REQUIRE w.id IS UNIQUE;
CREATE CONSTRAINT lessonplan_id IF NOT EXISTS FOR (l:LessonPlan) REQUIRE l.id IS UNIQUE;
CREATE FULLTEXT INDEX lessonplan_fulltext IF NOT EXISTS FOR (l:LessonPlan) ON EACH [l.title, l.subject];
