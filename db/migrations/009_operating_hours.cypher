// F1 — Operating hours & seasonal closures (plan §5 F1, Shared Primitives A + B).
// (:owner)-[:HAS_HOURS]->(:OperatingHours)-[:HAS_EXCEPTION]->(:HoursException); (:Park)-[:OPEN_IN]->(:Season).
// Idempotent: every statement uses IF NOT EXISTS. Runner splits on ';'.

CREATE CONSTRAINT operatinghours_id IF NOT EXISTS FOR (h:OperatingHours) REQUIRE h.id IS UNIQUE;
CREATE CONSTRAINT hoursexception_id IF NOT EXISTS FOR (e:HoursException) REQUIRE e.id IS UNIQUE;

// Domain seasons key on .name ONLY. The per-user availability anchor (:Season {userId}) has no .name,
// so this uniqueness constraint never touches it — the two coexist (see lib/sync/hours.ts comment).
CREATE CONSTRAINT season_name IF NOT EXISTS FOR (s:Season) REQUIRE s.name IS UNIQUE;

// Date-range filtering for "is this closed on my travel dates?" (stored as real date()).
CREATE RANGE INDEX hoursexception_startdate IF NOT EXISTS FOR (e:HoursException) ON (e.startDate);
CREATE RANGE INDEX hoursexception_enddate IF NOT EXISTS FOR (e:HoursException) ON (e.endDate);
