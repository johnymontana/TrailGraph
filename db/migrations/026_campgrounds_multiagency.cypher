// Multi-agency campgrounds & site-level campsites (Campgrounds feature, Phase 1). Adds :Campsite /
// :Agency / :RecArea and the federation key index on :Campground.ridbId so the RIDB import unifies with
// existing NPS campgrounds in place (one node per facility, never a duplicate). campground_id +
// campground_location (001) and the F3 inventory RANGE indexes (013) already exist and are reused.
// Idempotent (IF NOT EXISTS); the runner (db/migrate.ts) splits on ';' and skips '//' lines.

// ─── Uniqueness constraints: new natural keys ──────────────────────────────────
CREATE CONSTRAINT campsite_id IF NOT EXISTS FOR (s:Campsite) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT agency_id IF NOT EXISTS FOR (a:Agency) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT recarea_id IF NOT EXISTS FOR (r:RecArea) REQUIRE r.id IS UNIQUE;

// ─── Federation key: unify an NPS :Campground with its RIDB facility by ridbId ──
// sync-campgrounds-ridb OPTIONAL MATCHes (c:Campground {ridbId}) to merge in place; this index makes
// that lookup point-fast across ~3,600 facilities.
CREATE RANGE INDEX campground_ridbid IF NOT EXISTS FOR (c:Campground) ON (c.ridbId);

// ─── Campground multi-agency discovery facets (searchCampgrounds predicates) ────
CREATE RANGE INDEX campground_source IF NOT EXISTS FOR (c:Campground) ON (c.source);
CREATE RANGE INDEX campground_agency IF NOT EXISTS FOR (c:Campground) ON (c.agency);
CREATE RANGE INDEX campground_reservable IF NOT EXISTS FOR (c:Campground) ON (c.reservable);
CREATE RANGE INDEX campground_fcfs IF NOT EXISTS FOR (c:Campground) ON (c.fcfs);
CREATE RANGE INDEX campground_dispersed IF NOT EXISTS FOR (c:Campground) ON (c.dispersed);
CREATE RANGE INDEX campground_fee IF NOT EXISTS FOR (c:Campground) ON (c.feeUSD);
CREATE RANGE INDEX campground_pets IF NOT EXISTS FOR (c:Campground) ON (c.petsAllowed);
CREATE RANGE INDEX campground_rvmax IF NOT EXISTS FOR (c:Campground) ON (c.rvMaxLengthFt);

// ─── Campsite point + range indexes (site-level filters) ───────────────────────
// geometry holds a representative point() (pitch polygons live in Blob) so the point index works.
CREATE POINT INDEX campsite_location IF NOT EXISTS FOR (s:Campsite) ON (s.geometry);
CREATE RANGE INDEX campsite_campground IF NOT EXISTS FOR (s:Campsite) ON (s.campgroundId);
CREATE RANGE INDEX campsite_type IF NOT EXISTS FOR (s:Campsite) ON (s.type);
CREATE RANGE INDEX campsite_maxrv IF NOT EXISTS FOR (s:Campsite) ON (s.maxRvLengthFt);
CREATE RANGE INDEX campsite_amps IF NOT EXISTS FOR (s:Campsite) ON (s.electricAmps);
CREATE RANGE INDEX campsite_ada IF NOT EXISTS FOR (s:Campsite) ON (s.ada);
CREATE RANGE INDEX campsite_reservable IF NOT EXISTS FOR (s:Campsite) ON (s.reservable);

// ─── Fulltext: campground name search (searchCampgrounds q=) + rec-area name search ─────────────
CREATE FULLTEXT INDEX campground_fulltext IF NOT EXISTS FOR (c:Campground) ON EACH [c.name];
CREATE FULLTEXT INDEX recarea_fulltext IF NOT EXISTS FOR (r:RecArea) ON EACH [r.name];
