// F10 — Parking & EV logistics (plan §5 F10). Static props on (:ParkingLot); livedata stays runtime.
// parkinglot_id (003) already exists; HAS_HOURS shares the F1 OperatingHours model. Idempotent.

CREATE RANGE INDEX parkinglot_ev IF NOT EXISTS FOR (pl:ParkingLot) ON (pl.hasEvCharging);
CREATE RANGE INDEX parkinglot_accessiblespaces IF NOT EXISTS FOR (pl:ParkingLot) ON (pl.accessibleSpaces);
