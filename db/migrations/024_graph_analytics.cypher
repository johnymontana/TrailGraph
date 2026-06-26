// #7 — Graph analytics (GDS). Communities + centrality materialized onto the graph by the slow-sync
// derive steps (lib/sync/derive-communities.ts, derive-centrality.ts). This migration only creates the
// constraint + indexes the read paths (getInsights, the parks_in_cluster/central_parks/bridge_parks
// intents) rely on. The :Community nodes + (:Park)-[:IN_COMMUNITY]->(:Community) edges + Park.community/
// pagerank/betweenness props are written by GDS at sync time (schemaless), not here. Idempotent.

CREATE CONSTRAINT community_id IF NOT EXISTS FOR (c:Community) REQUIRE c.id IS UNIQUE;
CREATE INDEX park_community IF NOT EXISTS FOR (p:Park) ON (p.community);
CREATE INDEX park_pagerank IF NOT EXISTS FOR (p:Park) ON (p.pagerank);
CREATE INDEX park_betweenness IF NOT EXISTS FOR (p:Park) ON (p.betweenness);
// Optional: fuzzy topic matching for the ask-the-graph topic resolver (#5a).
CREATE FULLTEXT INDEX topic_fulltext IF NOT EXISTS FOR (t:Topic) ON EACH [t.name];
