// Campground context graph (memory + Camp Watch). The per-user camp-preferences anchor backs the
// PREFERS_CAMP bridge (mirrors :TrailPrefs / migration 025), and :CampWatch holds cancellation-alert
// criteria + the poller's per-watch diff snapshot. Availability itself is never graph nodes — it's a
// rolling fetch cache + :CampWatch.lastSnapshot. All idempotent.

// Per-user camp preferences anchor — (:User)-[:PREFERS_CAMP]->(:CampPrefs {userId}).
CREATE CONSTRAINT campprefs_user IF NOT EXISTS FOR (cp:CampPrefs) REQUIRE cp.userId IS UNIQUE;

// Camp Watch — (:User)-[:WATCHING]->(:CampWatch {id}). The poller scans active, non-expired watches.
CREATE CONSTRAINT campwatch_id IF NOT EXISTS FOR (w:CampWatch) REQUIRE w.id IS UNIQUE;
CREATE INDEX campwatch_user IF NOT EXISTS FOR (w:CampWatch) ON (w.userId);
CREATE INDEX campwatch_active IF NOT EXISTS FOR (w:CampWatch) ON (w.active);
