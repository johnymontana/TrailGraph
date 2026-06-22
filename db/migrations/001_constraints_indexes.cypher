// TrailGraph schema — constraints & indexes (ADR-002, ADR-006, ADR-012)
// Idempotent: every statement uses IF NOT EXISTS. Safe to re-run.
// Runner splits on ';' — keep one statement per terminator.

// ─── Uniqueness constraints: domain natural keys ───────────────────────────────
CREATE CONSTRAINT park_code IF NOT EXISTS FOR (p:Park) REQUIRE p.parkCode IS UNIQUE;
CREATE CONSTRAINT state_code IF NOT EXISTS FOR (s:State) REQUIRE s.code IS UNIQUE;
CREATE CONSTRAINT activity_id IF NOT EXISTS FOR (a:Activity) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT campground_id IF NOT EXISTS FOR (c:Campground) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT visitorcenter_id IF NOT EXISTS FOR (v:VisitorCenter) REQUIRE v.id IS UNIQUE;
CREATE CONSTRAINT thingtodo_id IF NOT EXISTS FOR (n:ThingToDo) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT place_id IF NOT EXISTS FOR (n:Place) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT alert_id IF NOT EXISTS FOR (a:Alert) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT amenity_id IF NOT EXISTS FOR (a:Amenity) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT tour_id IF NOT EXISTS FOR (t:Tour) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT article_id IF NOT EXISTS FOR (a:Article) REQUIRE a.id IS UNIQUE;

// ─── Uniqueness constraints: app-owned + context anchor ─────────────────────────
CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE;
CREATE CONSTRAINT trip_id IF NOT EXISTS FOR (t:Trip) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT stop_id IF NOT EXISTS FOR (s:Stop) REQUIRE s.id IS UNIQUE;

// ─── Uniqueness constraints: Better Auth (custom Neo4j adapter, ADR-008) ────────
CREATE CONSTRAINT auth_user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE;
CREATE CONSTRAINT auth_session_token IF NOT EXISTS FOR (s:AuthSession) REQUIRE s.token IS UNIQUE;
CREATE CONSTRAINT auth_session_id IF NOT EXISTS FOR (s:AuthSession) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT auth_account_id IF NOT EXISTS FOR (a:AuthAccount) REQUIRE a.id IS UNIQUE;
CREATE CONSTRAINT auth_verification_id IF NOT EXISTS FOR (v:AuthVerification) REQUIRE v.id IS UNIQUE;

// ─── Point indexes: proximity / bbox (B1-B2, ADR-004) ──────────────────────────
CREATE POINT INDEX park_location IF NOT EXISTS FOR (p:Park) ON (p.location);
CREATE POINT INDEX campground_location IF NOT EXISTS FOR (c:Campground) ON (c.location);
CREATE POINT INDEX visitorcenter_location IF NOT EXISTS FOR (v:VisitorCenter) ON (v.location);
CREATE POINT INDEX thingtodo_location IF NOT EXISTS FOR (n:ThingToDo) ON (n.location);
CREATE POINT INDEX place_location IF NOT EXISTS FOR (n:Place) ON (n.location);
CREATE POINT INDEX event_location IF NOT EXISTS FOR (e:Event) ON (e.location);

// ─── Full-text indexes: faceted/keyword search (A1) ────────────────────────────
CREATE FULLTEXT INDEX park_fulltext IF NOT EXISTS FOR (n:Park) ON EACH [n.name, n.fullName, n.description];
CREATE FULLTEXT INDEX thingtodo_fulltext IF NOT EXISTS FOR (n:ThingToDo) ON EACH [n.title, n.shortDescription];
CREATE FULLTEXT INDEX article_fulltext IF NOT EXISTS FOR (n:Article) ON EACH [n.title, n.body];

// ─── Vector indexes: semantic / "vibe" search (A4, ADR-012) — 1536-dim cosine ──
CREATE VECTOR INDEX park_embedding IF NOT EXISTS FOR (p:Park) ON (p.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } };
CREATE VECTOR INDEX thingtodo_embedding IF NOT EXISTS FOR (n:ThingToDo) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } };
CREATE VECTOR INDEX article_embedding IF NOT EXISTS FOR (n:Article) ON (n.embedding)
  OPTIONS { indexConfig: { `vector.dimensions`: 1536, `vector.similarity_function`: 'cosine' } };

// ─── Lookup indexes for sync/app hot paths ─────────────────────────────────────
CREATE INDEX alert_active IF NOT EXISTS FOR (a:Alert) ON (a.active);
CREATE INDEX trip_user IF NOT EXISTS FOR (t:Trip) ON (t.userId);
