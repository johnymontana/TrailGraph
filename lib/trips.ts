import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { routing, type LatLng } from './routing';
import { considerPark } from './bridges';

/**
 * Trip service (ADR-002/003). Canonical trips are bolt-written graph nodes owned by the app and
 * scoped by userId (R4). Itinerary uses the reified :Stop model; drive segments come from the
 * RoutingGateway (ADR-004) and are cached on :DRIVE_TO edges.
 */

export type StopKind = 'park' | 'campground' | 'poi' | 'custom';

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
      name: t.name,
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
    { userId, tripId, name },
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
    OPTIONAL MATCH (s)-[d:DRIVE_TO]->(:Stop)
    WITH t, s, p, c, poi, d
    ORDER BY s.order ASC
    RETURN t.id AS id, t.name AS name, t.startDate AS startDate, t.endDate AS endDate,
      collect(CASE WHEN s IS NULL THEN null ELSE {
        id: s.id, order: s.order, day: s.day, nights: s.nights, name: s.name,
        kind: s.kind,
        lat: coalesce(s.location.latitude, p.location.latitude, c.location.latitude, poi.location.latitude),
        lng: coalesce(s.location.longitude, p.location.longitude, c.location.longitude, poi.location.longitude),
        parkCode: p.parkCode, parkName: p.fullName,
        campgroundName: c.name, poiTitle: poi.title,
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
    (s) => s && (s.parkName || s.campgroundName || s.poiTitle || s.name || (s.lat != null && s.lng != null)),
  );
  return trip;
}

interface StopRow {
  id: string;
  order: number;
  name: string | null;
  lat: number | null;
  lng: number | null;
  parkName: string | null;
  campgroundName: string | null;
  poiTitle: string | null;
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
    const label = stop.kind === 'park' ? 'Park' : stop.kind === 'campground' ? 'Campground' : stop.kind === 'poi' ? 'ThingToDo' : null;
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
      name: stop.name ?? null,
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
  const segments = await routing.driveSegments(
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
