// F9 — Geographic regions & NEAR proximity graph (plan §5 F9).
// (:Region {name})<-[:IN_REGION]-(:Park); (:Park)-[:NEAR {miles}]->(:Park) (no edge index needed).
// Park point index park_location (001) backs the NEAR derivation. Idempotent.

CREATE CONSTRAINT region_name IF NOT EXISTS FOR (r:Region) REQUIRE r.name IS UNIQUE;
