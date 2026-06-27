// ADR-066/067/068/069 — Real hiking trails (:Trail), the named-aggregate of NPS Public Trails GIS
// centerline segments (one node per (UNITCODE, TRLNAME)). Geometry lives in Vercel Blob (ADR-067), NOT
// here — the graph holds metadata + trailheadPoint + bbox + geometryRef. Difficulty/elevation/estTime are
// DERIVED estimates (ADR-068/069). The per-user trail-preferences anchor backs the PREFERS_TRAIL bridge
// (ADR-071 companion). All idempotent.

CREATE CONSTRAINT trail_id IF NOT EXISTS FOR (t:Trail) REQUIRE t.id IS UNIQUE;
CREATE INDEX trail_parkcode IF NOT EXISTS FOR (t:Trail) ON (t.parkCode);
CREATE POINT INDEX trail_trailhead IF NOT EXISTS FOR (t:Trail) ON (t.trailheadPoint);
CREATE FULLTEXT INDEX trail_fulltext IF NOT EXISTS FOR (t:Trail) ON EACH [t.name];

// derive-trail-logistics seeks the nearest ParkingLot/Place to each trailhead by point.distance — but
// ParkingLot (migration 017) only has RANGE indexes, so its STARTS_AT branch full-scanned per trail while
// Place/Campground/VisitorCenter (migration 001) were index-backed. Add the missing point index for parity.
CREATE POINT INDEX parkinglot_location IF NOT EXISTS FOR (pl:ParkingLot) ON (pl.location);

// Range indexes back the trail finder's multi-constraint filters (length / gain / difficulty / time).
CREATE INDEX trail_length IF NOT EXISTS FOR (t:Trail) ON (t.lengthMiles);
CREATE INDEX trail_gain IF NOT EXISTS FOR (t:Trail) ON (t.elevationGainFt);
CREATE INDEX trail_rating IF NOT EXISTS FOR (t:Trail) ON (t.difficultyRating);
CREATE INDEX trail_esttime IF NOT EXISTS FOR (t:Trail) ON (t.estTimeHrs);

// Per-user trail preferences anchor — (:User)-[:PREFERS_TRAIL]->(:TrailPrefs {userId}) (ADR-071 companion).
CREATE CONSTRAINT trailprefs_user IF NOT EXISTS FOR (tp:TrailPrefs) REQUIRE tp.userId IS UNIQUE;

// Reserved for Phase 4 semantic trail vibe-search (filled by an embed step like embed-nodes.ts).
CREATE VECTOR INDEX trail_embedding IF NOT EXISTS FOR (t:Trail) ON (t.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } };
