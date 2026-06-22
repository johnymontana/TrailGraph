// NPS API expansion — new node constraints + indexes (Place/Tour already in 001; add the rest).
CREATE CONSTRAINT person_id IF NOT EXISTS FOR (n:Person) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT tourstop_id IF NOT EXISTS FOR (n:TourStop) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT passportstamp_id IF NOT EXISTS FOR (n:PassportStamp) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT entrancepass_id IF NOT EXISTS FOR (n:EntrancePass) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT parkinglot_id IF NOT EXISTS FOR (n:ParkingLot) REQUIRE n.id IS UNIQUE;

CREATE POINT INDEX person_location IF NOT EXISTS FOR (n:Person) ON (n.location);
CREATE FULLTEXT INDEX place_fulltext IF NOT EXISTS FOR (n:Place) ON EACH [n.title, n.bodyText];
CREATE FULLTEXT INDEX person_fulltext IF NOT EXISTS FOR (n:Person) ON EACH [n.title, n.bodyText];
CREATE INDEX amenity_name IF NOT EXISTS FOR (n:Amenity) ON (n.name);
CREATE INDEX campground_rv IF NOT EXISTS FOR (c:Campground) ON (c.rvMaxLengthFt);
CREATE INDEX campground_wheelchair IF NOT EXISTS FOR (c:Campground) ON (c.wheelchairAccessible);
