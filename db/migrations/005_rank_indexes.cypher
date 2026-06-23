// Live constraint re-ranking (ADR-046): range/lookup indexes for the rankParks hard filters.
// Bortle (park_bortle) + crowd (park_crowd) indexes already exist in 002_datasources.cypher.
CREATE INDEX campground_rvmaxlength IF NOT EXISTS FOR (c:Campground) ON (c.rvMaxLengthFt);
CREATE INDEX campground_wheelchair IF NOT EXISTS FOR (c:Campground) ON (c.wheelchairAccessible);
