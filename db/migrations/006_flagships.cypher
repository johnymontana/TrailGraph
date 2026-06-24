// Flagship epics (ADR-051..057): Proactive Ranger (watches + digests), Collective Intelligence v2
// (user-submitted SQM readings), and Trip Lab fork lineage. Idempotent — safe to re-run.

// --- Proactive Ranger ---------------------------------------------------------------------------
// :Watch — a standing rule a user attaches to a saved trip or a park (closures, clear-sky new-moon,
// fee-free days, alert spikes). :Digest — a per-user, per-day rollup the cron builds into the inbox.
CREATE CONSTRAINT watch_id IF NOT EXISTS FOR (w:Watch) REQUIRE w.id IS UNIQUE;
CREATE INDEX watch_user IF NOT EXISTS FOR (w:Watch) ON (w.userId);
CREATE CONSTRAINT digest_id IF NOT EXISTS FOR (d:Digest) REQUIRE d.id IS UNIQUE;
CREATE INDEX digest_user IF NOT EXISTS FOR (d:Digest) ON (d.userId);
CREATE INDEX digest_fordate IF NOT EXISTS FOR (d:Digest) ON (d.forDate);

// --- Collective Intelligence v2 ----------------------------------------------------------------
// :UserReading — a user-submitted sky-darkness reading (SQM), opt-in + anonymized, feeds the
// community leaderboard. Validated app-side (16 ≤ sqm ≤ 22, one per park per night).
CREATE CONSTRAINT userreading_id IF NOT EXISTS FOR (r:UserReading) REQUIRE r.id IS UNIQUE;
CREATE INDEX userreading_park IF NOT EXISTS FOR (r:UserReading) ON (r.parkCode);
CREATE INDEX userreading_user IF NOT EXISTS FOR (r:UserReading) ON (r.userId);

// --- Trip Lab -----------------------------------------------------------------------------------
// Fork lineage: a forked :Trip carries parentId + version so the diff view can show the family tree.
CREATE INDEX trip_parent IF NOT EXISTS FOR (t:Trip) ON (t.parentId);
