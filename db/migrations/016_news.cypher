// F8 — News & timely content (plan §5 F8). (:NewsRelease)-[:ABOUT]->(:Park).
// NOTE: no Article migration here — article_fulltext / article_embedding already exist (001); the F8/Sprint-0
// fix is writing Article.body so those indexes stop being empty. Idempotent.

CREATE CONSTRAINT newsrelease_id IF NOT EXISTS FOR (n:NewsRelease) REQUIRE n.id IS UNIQUE;
CREATE RANGE INDEX newsrelease_releasedate IF NOT EXISTS FOR (n:NewsRelease) ON (n.releaseDate);
CREATE FULLTEXT INDEX newsrelease_fulltext IF NOT EXISTS FOR (n:NewsRelease) ON EACH [n.title, n.abstract];
