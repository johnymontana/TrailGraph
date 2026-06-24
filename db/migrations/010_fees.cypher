// F2 — Structured fees & fee-free days (plan §5 F2, Shared Primitive C).
// (:Park)-[:CHARGES]->(:EntranceFee {cost:float,unit}); (:FeeFreeDay {date}). EntrancePass already in 003.
// Idempotent.

CREATE CONSTRAINT entrancefee_id IF NOT EXISTS FOR (f:EntranceFee) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT feefreeday_date IF NOT EXISTS FOR (d:FeeFreeDay) REQUIRE d.date IS UNIQUE;

CREATE RANGE INDEX entrancefee_cost IF NOT EXISTS FOR (f:EntranceFee) ON (f.cost);
