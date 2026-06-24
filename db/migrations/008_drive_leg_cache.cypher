// ORS drive-segment cache (audit C7). Idempotent — safe to re-run.
// :DriveLeg — a cached road distance/time between a rounded coordinate pair, shared across all trips so
// an identical pair isn't re-fetched from OpenRouteService. Unique on the coordinate quadruple.
CREATE CONSTRAINT driveleg_coords IF NOT EXISTS
  FOR (l:DriveLeg) REQUIRE (l.fromLat, l.fromLng, l.toLat, l.toLng) IS UNIQUE;
