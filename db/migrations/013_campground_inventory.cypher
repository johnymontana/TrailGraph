// F3 — Campground site-type & hookup inventory: range indexes on the new filterable props (plan §5 F3).
// campground_id (001), amenity_id/amenity_name (001/003) already exist. Idempotent.

CREATE RANGE INDEX campground_totalsites IF NOT EXISTS FOR (c:Campground) ON (c.totalSites);
CREATE RANGE INDEX campground_electric IF NOT EXISTS FOR (c:Campground) ON (c.electricSites);
CREATE RANGE INDEX campground_group IF NOT EXISTS FOR (c:Campground) ON (c.groupSites);
CREATE RANGE INDEX campground_firstcome IF NOT EXISTS FOR (c:Campground) ON (c.sitesFirstCome);
CREATE RANGE INDEX campground_hookups IF NOT EXISTS FOR (c:Campground) ON (c.hasHookups);
CREATE RANGE INDEX campground_dumpstation IF NOT EXISTS FOR (c:Campground) ON (c.hasDumpStation);
