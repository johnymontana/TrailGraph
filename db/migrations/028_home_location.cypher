// Home location (user-feedback iteration): a per-user anchor for where the user lives —
// (:User)-[:LIVES_AT]->(:Home {userId, location, label, source}). Mirrors the :TrailPrefs/:CampPrefs
// per-user-node pattern (migrations 025/027). `location` is a spatial point; `label` a human place name
// ("Bozeman, MT"); `source` records how it was captured ('geocode' | 'geolocation'). Feeds the trip-origin
// default, the memory block, distance-from-home ranking, and the /map home pin. Idempotent.
CREATE CONSTRAINT home_user IF NOT EXISTS FOR (h:Home) REQUIRE h.userId IS UNIQUE;
