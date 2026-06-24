// F5 — Accessibility graph (reuse :Amenity). No new label: accessibility is a tagged subset of :Amenity
// (accessibility = true) linked via the existing HAS_AMENITY edge. Index the flag for scorecard/facets.
// amenity_id / amenity_name already exist (001/003). Idempotent.

CREATE INDEX amenity_accessibility IF NOT EXISTS FOR (a:Amenity) ON (a.accessibility);
