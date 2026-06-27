import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { type LatLng } from './routing';
import { cachedDriveSegments } from './drive-cache';
import { considerPark } from './bridges';
import { buildParkConditions, type ConditionsCardData, type TripDashboard } from './conditions';
import { decodeEntities } from './html-entities';

/**
 * Trip service (ADR-002/003). Canonical trips are bolt-written graph nodes owned by the app and
 * scoped by userId (R4). Itinerary uses the reified :Stop model; drive segments come from the
 * RoutingGateway (ADR-004) and are cached on :DRIVE_TO edges.
 */

export type StopKind = 'park' | 'campground' | 'poi' | 'place' | 'custom';

export interface NewTrip {
  name: string;
  startDate?: string;
  endDate?: string;
  startPoint?: LatLng & { label?: string };
  endPoint?: LatLng & { label?: string };
}

export interface NewStop {
  kind: StopKind;
  refId?: string; // parkCode | campground id | thing-to-do id
  lat?: number;
  lng?: number;
  name?: string;
  day?: number;
  nights?: number;
}

/** Ensure the user anchor exists (also created by auth; MERGE is idempotent). */
async function ensureUser(userId: string) {
  await writeGraph(`MERGE (u:User {userId: $userId})`, { userId });
}

export async function createTrip(userId: string, t: NewTrip): Promise<string> {
  await ensureUser(userId);
  const id = randomUUID();
  await writeGraph(
    `
    MATCH (u:User {userId: $userId})
    CREATE (t:Trip {id: $id, userId: $userId})
      SET t.name = $name, t.startDate = $startDate, t.endDate = $endDate,
          t.startPoint = $startPoint, t.endPoint = $endPoint, t.createdAt = datetime()
    MERGE (u)-[:PLANNED]->(t)
    `,
    {
      userId,
      id,
      name: decodeEntities(t.name),
      startDate: t.startDate ?? null,
      endDate: t.endDate ?? null,
      startPoint: t.startPoint ? point(t.startPoint) : null,
      endPoint: t.endPoint ? point(t.endPoint) : null,
    },
  );
  return id;
}

function point(p: LatLng) {
  return { latitude: p.latitude, longitude: p.longitude };
}

/** Rename a trip (R3 §4.5 — keep the name in the user's control as contents change). userId-scoped. */
export async function renameTrip(userId: string, tripId: string, name: string): Promise<void> {
  await writeGraph(
    `MATCH (t:Trip {id: $tripId, userId: $userId}) SET t.name = $name`,
    { userId, tripId, name: decodeEntities(name) },
  );
}

export async function listTrips(userId: string) {
  return readGraph(
    `MATCH (t:Trip {userId: $userId})
     OPTIONAL MATCH (t)-[:HAS_STOP]->(s:Stop)
     WITH t, count(s) AS stops
     RETURN t.id AS id, t.name AS name, t.startDate AS startDate, t.endDate AS endDate, stops
     ORDER BY t.createdAt DESC`,
    { userId },
  );
}

export async function getTrip(userId: string, tripId: string) {
  const rows = await readGraph<{
    id: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
    stops: StopRow[];
  }>(
    `
    MATCH (t:Trip {id: $tripId, userId: $userId})
    OPTIONAL MATCH (t)-[:HAS_STOP]->(s:Stop)
    OPTIONAL MATCH (s)-[:OF_PARK]->(p:Park)
    OPTIONAL MATCH (s)-[:OF_CAMPGROUND]->(c:Campground)
    OPTIONAL MATCH (s)-[:OF_POI]->(poi:ThingToDo)
    OPTIONAL MATCH (s)-[:OF_PLACE]->(pl:Place)
    OPTIONAL MATCH (s)-[d:DRIVE_TO]->(:Stop)
    WITH t, s, p, c, poi, pl, d
    ORDER BY s.order ASC
    // Hikes nested under a stop (ADR-071) — a subquery so many INCLUDES_TRAIL edges don't multiply the row.
    CALL {
      WITH s
      OPTIONAL MATCH (s)-[:INCLUDES_TRAIL]->(tr:Trail)
      RETURN collect(DISTINCT tr{.id, .name, .lengthMiles, .estTimeHrs, .difficulty, permitRequired: coalesce(tr.permitRequired, false)}) AS hikes
    }
    RETURN t.id AS id, t.name AS name, t.startDate AS startDate, t.endDate AS endDate,
      collect(CASE WHEN s IS NULL THEN null ELSE {
        id: s.id, order: s.order, day: s.day, nights: s.nights, name: s.name,
        kind: s.kind,
        lat: coalesce(s.location.latitude, p.location.latitude, c.location.latitude, poi.location.latitude, pl.location.latitude),
        lng: coalesce(s.location.longitude, p.location.longitude, c.location.longitude, poi.location.longitude, pl.location.longitude),
        parkCode: p.parkCode, parkName: p.fullName,
        campgroundName: c.name, poiTitle: poi.title, placeTitle: pl.title,
        hikes: hikes,
        driveTo: CASE WHEN d IS NULL THEN null ELSE {miles: d.miles, minutes: d.minutes, source: d.source} END
      } END) AS stops
    `,
    { userId, tripId },
  );
  const trip = rows[0];
  if (!trip) return null;
  // Drop orphan stops with nothing to show — no resolved park/campground/POI and no custom label
  // (legacy data from before addStop validation; §2.4). A custom stop keeps its own name/coords.
  trip.stops = (trip.stops ?? []).filter(
    (s) => s && (s.parkName || s.campgroundName || s.poiTitle || s.placeTitle || s.name || (s.lat != null && s.lng != null)),
  );
  return trip;
}

/** A hike attached to a stop (ADR-071): the trip-side of `(:Stop)-[:INCLUDES_TRAIL]->(:Trail)`. */
export interface TripHike {
  id: string;
  name: string;
  lengthMiles: number | null;
  estTimeHrs: number | null;
  difficulty: string | null;
  permitRequired: boolean;
}

interface StopRow {
  id: string;
  order: number;
  day: number | null;
  nights: number | null;
  name: string | null;
  kind: StopKind | null;
  parkCode: string | null;
  lat: number | null;
  lng: number | null;
  parkName: string | null;
  campgroundName: string | null;
  poiTitle: string | null;
  placeTitle: string | null;
  hikes: TripHike[];
  driveTo: { miles: number; minutes: number; source: string } | null;
}

/**
 * Attach a hike to a stop (ADR-071): `(:Stop)-[:INCLUDES_TRAIL]->(:Trail)`. Both must exist + the trip
 * must be the caller's. Returns false on an unknown stop/trail (so the ranger learns it wasn't added).
 */
export async function addTrailToStop(
  userId: string,
  tripId: string,
  stopId: string,
  trailId: string,
): Promise<boolean> {
  const rows = await writeGraph<{ ok: boolean }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop {id:$stopId})
     MATCH (tr:Trail {id:$trailId})
     MERGE (s)-[:INCLUDES_TRAIL]->(tr)
     RETURN true AS ok`,
    { userId, tripId, stopId, trailId },
  );
  return rows.length > 0;
}

export async function removeTrailFromStop(
  userId: string,
  tripId: string,
  stopId: string,
  trailId: string,
): Promise<void> {
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop {id:$stopId})-[r:INCLUDES_TRAIL]->(:Trail {id:$trailId})
     DELETE r`,
    { userId, tripId, stopId, trailId },
  );
}

/** A trip's hikes paired with their park's Blob geo URL (ADR-067/071) — geometry lives in Blob, not the
 *  graph, so GPX/offline read the real polyline from `:Park.trailsGeoUrl`. Distinct per trail. */
export interface TripHikeRef {
  trailId: string;
  name: string;
  parkCode: string | null;
  geoUrl: string | null;
}
export async function tripHikeRefs(userId: string, tripId: string): Promise<TripHikeRef[]> {
  return readGraph<TripHikeRef>(
    `MATCH (:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(:Stop)-[:INCLUDES_TRAIL]->(tr:Trail)-[:IN_PARK]->(p:Park)
     RETURN DISTINCT tr.id AS trailId, tr.name AS name, tr.parkCode AS parkCode, p.trailsGeoUrl AS geoUrl`,
    { userId, tripId },
  );
}

export async function addStop(userId: string, tripId: string, stop: NewStop): Promise<string | null> {
  const owns = await readGraph<{ ok: boolean }>(
    `MATCH (t:Trip {id: $tripId, userId: $userId}) RETURN true AS ok`,
    { userId, tripId },
  );
  if (!owns.length) return null;

  // Validate the referenced domain entity EXISTS before creating a stop (§2.5): a bad/hallucinated
  // parkCode must not produce a nameless "1. Stop". Custom stops (no refId) carry their own lat/lng.
  if (stop.refId) {
    const label = stop.kind === 'park' ? 'Park' : stop.kind === 'campground' ? 'Campground' : stop.kind === 'poi' ? 'ThingToDo' : stop.kind === 'place' ? 'Place' : null;
    const keyField = stop.kind === 'park' ? 'parkCode' : 'id';
    if (label) {
      const exists = await readGraph<{ ok: boolean }>(
        `MATCH (n:\`${label}\` {${keyField}: $refId}) RETURN true AS ok LIMIT 1`,
        { refId: stop.refId },
      );
      if (!exists.length) return null; // unknown reference → caller learns it wasn't added
    }
  }

  const id = randomUUID();
  // next order = current max + 1
  await writeGraph(
    `
    MATCH (t:Trip {id: $tripId, userId: $userId})
    OPTIONAL MATCH (t)-[:HAS_STOP]->(existing:Stop)
    WITH t, coalesce(max(existing.order), -1) + 1 AS nextOrder
    CREATE (s:Stop {id: $id})
      SET s.order = nextOrder, s.kind = $kind, s.day = $day, s.nights = $nights, s.name = $name,
          s.location = CASE WHEN $lat IS NOT NULL AND $lng IS NOT NULL
                            THEN point({latitude:$lat, longitude:$lng}) ELSE null END
    MERGE (t)-[:HAS_STOP]->(s)
    WITH s
    CALL {
      WITH s
      MATCH (p:Park {parkCode: $refId}) WHERE $kind = 'park' MERGE (s)-[:OF_PARK]->(p)
    }
    CALL {
      WITH s
      MATCH (c:Campground {id: $refId}) WHERE $kind = 'campground' MERGE (s)-[:OF_CAMPGROUND]->(c)
    }
    CALL {
      WITH s
      MATCH (poi:ThingToDo {id: $refId}) WHERE $kind = 'poi' MERGE (s)-[:OF_POI]->(poi)
    }
    CALL {
      WITH s
      MATCH (pl:Place {id: $refId}) WHERE $kind = 'place' MERGE (s)-[:OF_PLACE]->(pl)
    }
    RETURN s.id AS id
    `,
    {
      userId,
      tripId,
      id,
      kind: stop.kind,
      refId: stop.refId ?? null,
      lat: stop.lat ?? null,
      lng: stop.lng ?? null,
      name: stop.name != null ? decodeEntities(stop.name) : null,
      day: stop.day ?? null,
      nights: stop.nights ?? null,
    },
  );
  // Adding a park to a trip is a strong preference signal → record a CONSIDERED bridge (§5).
  if (stop.kind === 'park' && stop.refId) {
    await considerPark(userId, stop.refId, 'added_to_trip').catch(() => {});
  }
  await recomputeSegments(userId, tripId);
  return id;
}

export async function removeStop(userId: string, tripId: string, stopId: string): Promise<void> {
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop {id:$stopId}) DETACH DELETE s`,
    { userId, tripId, stopId },
  );
  await renumber(userId, tripId);
  await recomputeSegments(userId, tripId);
}

export async function reorderStops(userId: string, tripId: string, orderedStopIds: string[]): Promise<void> {
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop)
     WITH s, $ids AS ids
     SET s.order = apoc.coll.indexOf(ids, s.id)`,
    { userId, tripId, ids: orderedStopIds },
  ).catch(async () => {
    // No APOC? fall back to per-stop updates.
    for (let i = 0; i < orderedStopIds.length; i++) {
      await writeGraph(
        `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop {id:$sid}) SET s.order = $o`,
        { userId, tripId, sid: orderedStopIds[i], o: i },
      );
    }
  });
  await recomputeSegments(userId, tripId);
}

async function renumber(userId: string, tripId: string) {
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop)
     WITH s ORDER BY s.order ASC
     WITH collect(s) AS stops
     UNWIND range(0, size(stops)-1) AS i
     SET (stops[i]).order = i`,
    { userId, tripId },
  );
}

/** Recompute :DRIVE_TO edges between consecutive stops via the RoutingGateway (ADR-004). */
export async function recomputeSegments(userId: string, tripId: string): Promise<void> {
  const stops = (await getTrip(userId, tripId))?.stops?.filter(Boolean) as
    | { id: string; lat: number | null; lng: number | null }[]
    | undefined;
  if (!stops || stops.length < 2) return;

  // clear existing segments
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(:Stop)-[d:DRIVE_TO]->(:Stop) DELETE d`,
    { userId, tripId },
  );

  const located = stops.filter((s) => s.lat != null && s.lng != null);
  if (located.length < 2) return;
  const segments = await cachedDriveSegments(
    located.map((s) => ({ latitude: s.lat as number, longitude: s.lng as number })),
  );
  for (const seg of segments) {
    const from = located[seg.fromIndex];
    const to = located[seg.toIndex];
    await writeGraph(
      `MATCH (a:Stop {id:$from}), (b:Stop {id:$to})
       MERGE (a)-[d:DRIVE_TO]->(b)
       SET d.miles = $miles, d.minutes = $minutes, d.source = $source, d.computedAt = datetime()`,
      { from: from.id, to: to.id, miles: seg.miles, minutes: seg.minutes, source: seg.source },
    );
  }
}

/**
 * Seed a new trip from an official NPS tour (NPS-expansion P1 #3): a tour is a graph path
 * `(:Tour)-[:HAS_STOP]->(:TourStop {ordinal})-[:AT]->(:Place|:Campground|:VisitorCenter)`. We
 * materialize each stop in order — Place→`place` stop, Campground→`campground`, VisitorCenter→a
 * custom stop carrying the VC name/coords (no VC stop kind). Returns null if the tour has no usable
 * stops. The user can then remix it with the ranger (reorder, drop strenuous stops, add stamps).
 */
export async function createTripFromTour(
  userId: string,
  tourId: string,
): Promise<{ tripId: string; name: string; stops: number } | null> {
  const rows = await readGraph<{
    title: string | null;
    stops: {
      ordinal: number;
      placeId: string | null;
      cgId: string | null;
      vcName: string | null;
      vcLat: number | null;
      vcLng: number | null;
    }[];
  }>(
    `
    MATCH (tr:Tour {id: $tourId})
    OPTIONAL MATCH (tr)-[:HAS_STOP]->(ts:TourStop)
    OPTIONAL MATCH (ts)-[:AT]->(target)
    WITH tr, ts, target ORDER BY ts.ordinal ASC
    RETURN tr.title AS title, collect(CASE WHEN ts IS NULL THEN null ELSE {
      ordinal: coalesce(ts.ordinal, 0),
      placeId: CASE WHEN target:Place THEN target.id ELSE null END,
      cgId: CASE WHEN target:Campground THEN target.id ELSE null END,
      vcName: CASE WHEN target:VisitorCenter THEN target.name ELSE null END,
      vcLat: CASE WHEN target:VisitorCenter THEN target.location.latitude ELSE null END,
      vcLng: CASE WHEN target:VisitorCenter THEN target.location.longitude ELSE null END
    } END) AS stops
    `,
    { tourId },
  );
  if (!rows.length || !rows[0].title) return null;
  const tour = rows[0];
  const name = `${tour.title} (tour)`;
  const tripId = await createTrip(userId, { name });
  let count = 0;
  for (const st of (tour.stops ?? []).filter(Boolean)) {
    if (st.placeId) {
      if (await addStop(userId, tripId, { kind: 'place', refId: st.placeId })) count++;
    } else if (st.cgId) {
      if (await addStop(userId, tripId, { kind: 'campground', refId: st.cgId })) count++;
    } else if (st.vcName) {
      if (await addStop(userId, tripId, { kind: 'custom', name: st.vcName, lat: st.vcLat ?? undefined, lng: st.vcLng ?? undefined })) count++;
    }
  }
  if (count === 0) {
    await deleteTrip(userId, tripId);
    return null;
  }
  return { tripId, name, stops: count };
}

/**
 * Read-only PREVIEW of the trip a tour would seed — same ordered traversal as createTripFromTour but
 * writes nothing (P1.3 confirm-before-save). Returns the tour name + ordered stop names so the ranger can
 * render a draft `itinerary_preview` with a Save button before persisting. Null when the tour has no usable
 * named stops (mirrors createTripFromTour's empty-tour guard).
 */
export async function previewTourFromTour(
  tourId: string,
): Promise<{ name: string; stops: { name: string }[] } | null> {
  const rows = await readGraph<{ title: string | null; stops: { ordinal: number; name: string | null }[] }>(
    `
    MATCH (tr:Tour {id: $tourId})
    OPTIONAL MATCH (tr)-[:HAS_STOP]->(ts:TourStop)
    OPTIONAL MATCH (ts)-[:AT]->(target)
    WITH tr, ts, target ORDER BY ts.ordinal ASC
    RETURN tr.title AS title, collect(CASE WHEN ts IS NULL THEN null ELSE {
      ordinal: coalesce(ts.ordinal, 0),
      // Place stores its label in .title; VisitorCenter/Campground use .name — coalesce so a tour's
      // Place stops are not silently dropped from the preview (the saved trip shows them).
      name: coalesce(target.name, target.title)
    } END) AS stops
    `,
    { tourId },
  );
  if (!rows.length || !rows[0].title) return null;
  const stops = (rows[0].stops ?? [])
    .filter((s): s is { ordinal: number; name: string } => !!s && !!s.name)
    .map((s) => ({ name: s.name }));
  if (!stops.length) return null;
  return { name: `${rows[0].title} (tour)`, stops };
}

export interface TripCost {
  perPark: { parkCode: string; parkName: string; fee: number }[];
  total: number;
  atbPrice: number;
  holdsAtb: boolean;
  atbSaves: boolean;
}

/**
 * Trip entrance-fee cost model (NPS-expansion P2 #9). Sums the per-park vehicle entrance fee across the
 * trip's distinct parks (from the synced `Park.entranceFees` JSON — we take the max line, ≈ the private
 * vehicle fee), then compares to the $80 America the Beautiful annual pass for break-even. If the user
 * already `HOLDS` the annual pass, those parks are covered (total shown as 0). userId-scoped (R4).
 */
export async function tripCost(userId: string, tripId: string): Promise<TripCost> {
  const rows = await readGraph<{ parkCode: string; parkName: string; fees: string | null }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(:Stop)-[:OF_PARK]->(p:Park)
     RETURN DISTINCT p.parkCode AS parkCode, p.fullName AS parkName, p.entranceFees AS fees`,
    { userId, tripId },
  );
  const held = await readGraph<{ ok: boolean }>(
    `MATCH (:User {userId:$userId})-[:HOLDS]->(:EntrancePass {id:'atb-annual'}) RETURN true AS ok`,
    { userId },
  );
  const holdsAtb = held.length > 0;
  const atbPrice = 80;
  const perPark = rows.map((r) => {
    let fee = 0;
    try {
      const arr = (r.fees ? JSON.parse(r.fees) : []) as { cost?: string }[];
      fee = arr.reduce((max, f) => Math.max(max, Number(f.cost) || 0), 0);
    } catch {
      fee = 0;
    }
    return { parkCode: r.parkCode, parkName: r.parkName, fee };
  });
  const gross = perPark.reduce((s, p) => s + p.fee, 0);
  return { perPark, total: holdsAtb ? 0 : gross, atbPrice, holdsAtb, atbSaves: gross > atbPrice };
}

export async function deleteTrip(userId: string, tripId: string): Promise<void> {
  await writeGraph(
    `MATCH (t:Trip {id:$tripId, userId:$userId})
     OPTIONAL MATCH (t)-[:HAS_STOP]->(s:Stop)
     DETACH DELETE t, s`,
    { userId, tripId },
  );
}

/**
 * Per-trip alert check (C3, ADR-005): authoritative park-level AFFECTS for Closure/Danger, plus
 * best-effort campground-name "mentions" in alert text — clearly labeled, never structured.
 */
export async function checkTripAlerts(userId: string, tripId: string) {
  return readGraph(
    `
    MATCH (t:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop)
    OPTIONAL MATCH (s)-[:OF_PARK]->(p:Park)
    OPTIONAL MATCH (s)-[:OF_CAMPGROUND]->(c:Campground)-[:IN_PARK]->(cp:Park)
    WITH collect(DISTINCT p) + collect(DISTINCT cp) AS parks,
         collect(DISTINCT c.name) AS cgNames
    UNWIND parks AS park
    MATCH (a:Alert)-[:AFFECTS]->(park)
    WHERE a.active = true AND a.category IN ['Closure','Danger']
    RETURN park.parkCode AS parkCode, park.fullName AS park,
      collect({
        id: a.id, category: a.category, title: a.title, url: a.url,
        mentionsCampgrounds: [n IN cgNames WHERE toLower(a.description) CONTAINS toLower(n)]
      }) AS alerts
    `,
    { userId, tripId },
  );
}

/**
 * Aggregate per-stop conditions for a built trip into the Trip Dashboard (ADR-042). Reads the trip's
 * park stops and builds each one's structured conditions from the single fact source. Returns null if
 * the trip doesn't exist / isn't the caller's.
 */
export async function tripConditions(userId: string, tripId: string): Promise<TripDashboard | null> {
  const trip = await getTrip(userId, tripId);
  if (!trip) return null;
  const parkStops = trip.stops.filter((s) => s.kind === 'park' && s.parkCode);
  const built = await Promise.all(parkStops.map((s) => buildParkConditions(s.parkCode as string, s.order)));
  const stops = built.filter((s): s is ConditionsCardData => s != null);
  return { tripId: trip.id, tripName: trip.name, startDate: trip.startDate, endDate: trip.endDate, stops };
}
