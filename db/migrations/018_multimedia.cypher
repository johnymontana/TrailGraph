// F6 — Self-guided audio tours & multimedia (plan §5 F6). (:AudioFile|:Gallery|:Video)-[:ABOUT]->(:Park).
// Opt-in corpus (SYNC_MULTIMEDIA=1). Transcript embedding deferred (no vector index yet). Idempotent.

CREATE CONSTRAINT audiofile_id IF NOT EXISTS FOR (a:AudioFile) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT gallery_id IF NOT EXISTS FOR (g:Gallery) REQUIRE g.id IS UNIQUE;
CREATE CONSTRAINT video_id IF NOT EXISTS FOR (v:Video) REQUIRE v.id IS UNIQUE;
