// F4 — Rich event calendar with recurrence (plan §5 F4).
// (:Event)-[:OF_TYPE]->(:EventType); (:Event)-[:TAGGED]->(:Topic); (:Event)-[:OCCURS_ON]->(:CalendarDate).
// event_id (001) + event_location point (001) already exist. Idempotent.

CREATE CONSTRAINT eventtype_name IF NOT EXISTS FOR (t:EventType) REQUIRE t.name IS UNIQUE;
CREATE CONSTRAINT calendardate_date IF NOT EXISTS FOR (d:CalendarDate) REQUIRE d.date IS UNIQUE;
