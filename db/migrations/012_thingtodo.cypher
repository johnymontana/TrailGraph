// F7 — ThingToDo enrichment: range indexes on the new scalar filter facets (plan §5 F7).
// (Array facets timeOfDay/season are filtered with list predicates — not range-indexable.)
// ttd difficulty index already exists in 002. Idempotent.

CREATE RANGE INDEX thingtodo_lengthmiles IF NOT EXISTS FOR (n:ThingToDo) ON (n.lengthMiles);
CREATE RANGE INDEX thingtodo_elevation IF NOT EXISTS FOR (n:ThingToDo) ON (n.elevationGainFt);
CREATE RANGE INDEX thingtodo_pets IF NOT EXISTS FOR (n:ThingToDo) ON (n.petsAllowed);
CREATE RANGE INDEX thingtodo_reservation IF NOT EXISTS FOR (n:ThingToDo) ON (n.reservationRequired);
