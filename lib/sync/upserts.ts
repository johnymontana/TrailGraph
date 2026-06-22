import { writeGraph, readGraph } from '../neo4j';
import { STATE_NAMES } from '../us-states';
import type {
  NpsAlert,
  NpsCampground,
  NpsPark,
  NpsThingToDo,
  NpsActivityRef,
  NpsGeneric,
  NpsPlace,
  NpsPerson,
  NpsTour,
  NpsPassportStamp,
  NpsParkingLot,
  NpsArticle,
} from '../nps';

/**
 * Normalize the free-text `campground.accessibility` blob into structured props (R-NPS §accessibility):
 * a wheelchair boolean and an RV max-length in feet, for graph filtering. Pure (unit-tested).
 */
export function normalizeCampgroundAccessibility(acc: Record<string, unknown> | undefined): {
  wheelchairAccessible: boolean;
  rvMaxLengthFt: number | null;
  adaInfo: string | null;
} {
  const a = acc ?? {};
  const wc = `${a.wheelchairAccess ?? ''} ${(Array.isArray(a.classifications) ? a.classifications.join(' ') : '')}`;
  const wheelchairAccessible = /accessible|wheelchair/i.test(wc) && !/not accessible|no wheelchair/i.test(wc);
  const rv = Number(a.rvMaxLength ?? a.rvMaxLengthHostString ?? '');
  return {
    wheelchairAccessible,
    rvMaxLengthFt: Number.isFinite(rv) && rv > 0 ? Math.round(rv) : null,
    adaInfo: typeof a.adaInfo === 'string' && a.adaInfo ? (a.adaInfo as string) : null,
  };
}

/**
 * Idempotent upserts (ADR-007). Every write is MERGE-on-natural-key + SET, so re-running a sync is
 * safe and self-healing. Nested park-local detail is stored as JSON strings on :Park (ADR-006).
 */

const j = (x: unknown): string | null => (x == null ? null : JSON.stringify(x));

function num(s: string | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function upsertParks(parks: NpsPark[]): Promise<number> {
  if (!parks.length) return 0;
  const rows = parks.map((p) => ({
    parkCode: p.parkCode,
    name: p.name,
    fullName: p.fullName,
    designation: p.designation,
    description: p.description,
    states: p.states,
    url: p.url,
    directionsUrl: p.directionsUrl ?? null,
    directionsInfo: p.directionsInfo ?? null,
    weatherInfo: p.weatherInfo ?? null,
    lat: num(p.latitude),
    lng: num(p.longitude),
    entranceFees: j(p.entranceFees ?? []),
    entrancePasses: j(p.entrancePasses ?? []),
    operatingHours: j(p.operatingHours ?? []),
    contacts: j(p.contacts ?? {}),
    addresses: j(p.addresses ?? []),
    images: (p.images ?? []).map((i) => i.url),
    imagesFull: j(p.images ?? []),
    feeFree: !(p.entranceFees && p.entranceFees.length > 0),
    stateCodes: (p.states ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    activities: (p.activities ?? []).map((a) => ({ id: a.id, name: a.name })),
    topics: (p.topics ?? []).map((t) => ({ id: t.id, name: t.name })),
  }));

  const result = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (p:Park {parkCode: row.parkCode})
      SET p.name = row.name, p.fullName = row.fullName, p.designation = row.designation,
          p.description = row.description, p.states = row.states, p.url = row.url,
          p.directionsUrl = row.directionsUrl, p.directionsInfo = row.directionsInfo,
          p.weatherInfo = row.weatherInfo, p.entranceFees = row.entranceFees,
          p.entrancePasses = row.entrancePasses, p.operatingHours = row.operatingHours,
          p.contacts = row.contacts, p.addresses = row.addresses, p.images = row.images,
          p.imagesFull = row.imagesFull, p.feeFree = row.feeFree,
          p.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                            THEN point({latitude: row.lat, longitude: row.lng}) ELSE p.location END,
          p.lastSyncedAt = datetime()
    WITH p, row
    CALL {
      WITH p, row
      UNWIND row.activities AS act
      MERGE (a:Activity {id: act.id}) SET a.name = act.name
      MERGE (p)-[:OFFERS]->(a)
    }
    CALL {
      WITH p, row
      UNWIND row.topics AS top
      MERGE (t:Topic {id: top.id}) SET t.name = top.name
      MERGE (p)-[:HAS_TOPIC]->(t)
    }
    CALL {
      WITH p, row
      UNWIND row.stateCodes AS sc
      MERGE (s:State {code: sc})
      SET s.name = coalesce(s.name, $stateNames[sc], sc)
      MERGE (p)-[:LOCATED_IN]->(s)
    }
    RETURN count(p) AS c
    `,
    { rows, stateNames: STATE_NAMES },
  );
  return result[0]?.c ?? 0;
}

/** Standalone vocabulary (activities/topics/amenities) — ensures names even before park links. */
export async function upsertNamed(label: string, items: NpsActivityRef[]): Promise<number> {
  if (!items.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `UNWIND $items AS it MERGE (n:\`${label}\` {id: it.id}) SET n.name = it.name RETURN count(n) AS c`,
    { items: items.map((i) => ({ id: i.id, name: i.name })) },
  );
  return r[0]?.c ?? 0;
}

export async function upsertCampgrounds(cgs: NpsCampground[]): Promise<number> {
  if (!cgs.length) return 0;
  const rows = cgs.map((c) => {
    const acc = normalizeCampgroundAccessibility(c.accessibility);
    return {
      id: c.id,
      name: c.name,
      parkCode: c.parkCode,
      description: c.description ?? null,
      reservationUrl: c.reservationUrl ?? null,
      lat: num(c.latitude),
      lng: num(c.longitude),
      amenities: j(c.amenities ?? {}),
      accessibility: j(c.accessibility ?? {}),
      wheelchairAccessible: acc.wheelchairAccessible,
      rvMaxLengthFt: acc.rvMaxLengthFt,
      adaInfo: acc.adaInfo,
    };
  });
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (c:Campground {id: row.id})
      SET c.name = row.name, c.description = row.description, c.reservationUrl = row.reservationUrl,
          c.amenities = row.amenities, c.accessibility = row.accessibility,
          c.wheelchairAccessible = row.wheelchairAccessible, c.rvMaxLengthFt = row.rvMaxLengthFt,
          c.adaInfo = row.adaInfo,
          c.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                            THEN point({latitude: row.lat, longitude: row.lng}) ELSE c.location END,
          c.lastSyncedAt = datetime()
    WITH c, row WHERE row.parkCode IS NOT NULL
    MATCH (p:Park {parkCode: row.parkCode})
    MERGE (c)-[:IN_PARK]->(p)
    RETURN count(c) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

export async function upsertThingsToDo(items: NpsThingToDo[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((t) => ({
    id: t.id,
    title: t.title,
    shortDescription: t.shortDescription ?? null,
    lat: num(t.latitude),
    lng: num(t.longitude),
    parkCodes: (t.relatedParks ?? []).map((p) => p.parkCode).filter(Boolean),
    activities: (t.activities ?? []).map((a) => ({ id: a.id, name: a.name })),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (n:ThingToDo {id: row.id})
      SET n.title = row.title, n.shortDescription = row.shortDescription,
          n.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                            THEN point({latitude: row.lat, longitude: row.lng}) ELSE n.location END,
          n.lastSyncedAt = datetime()
    WITH n, row
    CALL {
      WITH n, row
      UNWIND row.parkCodes AS pc
      MATCH (p:Park {parkCode: pc}) MERGE (n)-[:AT_PARK]->(p)
    }
    CALL {
      WITH n, row
      UNWIND row.activities AS act
      MERGE (a:Activity {id: act.id}) SET a.name = act.name
      MERGE (n)-[:INVOLVES]->(a)
    }
    RETURN count(n) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/** Alerts: upsert active=true for everything in this pull, soft-expire the rest (ADR-005/§9.2). */
export async function upsertAlerts(alerts: NpsAlert[]): Promise<{ active: number; expired: number }> {
  const rows = alerts.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description ?? '',
    category: a.category ?? 'Information',
    url: a.url ?? null,
    parkCode: a.parkCode,
    lastIndexedDate: a.lastIndexedDate ?? null,
  }));
  const ids = rows.map((r) => r.id);

  const up = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (a:Alert {id: row.id})
      SET a.title = row.title, a.description = row.description, a.category = row.category,
          a.url = row.url, a.lastIndexedDate = row.lastIndexedDate, a.active = true,
          a.lastSyncedAt = datetime()
    WITH a, row WHERE row.parkCode IS NOT NULL
    MATCH (p:Park {parkCode: row.parkCode})
    MERGE (a)-[:AFFECTS]->(p)
    RETURN count(a) AS c
    `,
    { rows },
  );
  const expired = await writeGraph<{ c: number }>(
    `MATCH (a:Alert) WHERE a.active = true AND NOT a.id IN $ids
     SET a.active = false RETURN count(a) AS c`,
    { ids },
  );
  return { active: up[0]?.c ?? 0, expired: expired[0]?.c ?? 0 };
}

export async function upsertVisitorCenters(items: NpsGeneric[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((v) => ({
    id: String(v.id),
    name: String(v.name ?? ''),
    parkCode: (v.parkCode as string) ?? null,
    lat: num(v.latitude as string | undefined),
    lng: num(v.longitude as string | undefined),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (v:VisitorCenter {id: row.id})
      SET v.name = row.name,
          v.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                            THEN point({latitude: row.lat, longitude: row.lng}) ELSE v.location END,
          v.lastSyncedAt = datetime()
    WITH v, row WHERE row.parkCode IS NOT NULL
    MATCH (p:Park {parkCode: row.parkCode}) MERGE (v)-[:IN_PARK]->(p)
    RETURN count(v) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/** Places (POIs): `(:Park)-[:HAS_PLACE]->(:Place)`; carries audio/stamp flags + images (R-NPS §places). */
export async function upsertPlaces(places: NpsPlace[]): Promise<number> {
  if (!places.length) return 0;
  const rows = places.map((p) => ({
    id: p.id,
    title: p.title,
    bodyText: p.bodyText ?? p.listingDescription ?? null,
    lat: num(p.latitude),
    lng: num(p.longitude),
    audioDescription: p.audioDescription ?? null,
    isStamp: p.isPassportStampLocation === true || p.isPassportStampLocation === 'true',
    images: (p.images ?? []).map((i) => i.url),
    imagesFull: j(p.images ?? []),
    tags: (p.tags ?? []).filter(Boolean),
    parkCodes: (p.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (pl:Place {id: row.id})
      SET pl.title = row.title, pl.bodyText = row.bodyText, pl.audioDescription = row.audioDescription,
          pl.isStamp = row.isStamp, pl.images = row.images, pl.imagesFull = row.imagesFull, pl.tags = row.tags,
          pl.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                             THEN point({latitude: row.lat, longitude: row.lng}) ELSE pl.location END,
          pl.lastSyncedAt = datetime()
    WITH pl, row
    CALL { WITH pl, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (p)-[:HAS_PLACE]->(pl) }
    RETURN count(pl) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/** People: `(:Person)-[:ASSOCIATED_WITH]->(:Park)` + `RELATES_TO_TOPIC` where a tag matches a Topic. */
export async function upsertPeople(people: NpsPerson[]): Promise<number> {
  if (!people.length) return 0;
  const rows = people.map((p) => ({
    id: p.id,
    title: p.title,
    bodyText: p.bodyText ?? p.listingDescription ?? null,
    lat: num(p.latitude),
    lng: num(p.longitude),
    images: (p.images ?? []).map((i) => i.url),
    tags: (p.tags ?? []).filter(Boolean),
    parkCodes: (p.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (per:Person {id: row.id})
      SET per.title = row.title, per.bodyText = row.bodyText, per.images = row.images, per.tags = row.tags,
          per.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                              THEN point({latitude: row.lat, longitude: row.lng}) ELSE per.location END,
          per.lastSyncedAt = datetime()
    WITH per, row
    CALL { WITH per, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (per)-[:ASSOCIATED_WITH]->(p) }
    CALL { WITH per, row UNWIND row.tags AS tag MATCH (t:Topic {name: tag}) MERGE (per)-[:RELATES_TO_TOPIC]->(t) }
    RETURN count(per) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/** Tours: `(:Tour)-[:HAS_STOP]->(:TourStop {ordinal})-[:AT]->(:Place|:Campground|:VisitorCenter)`. */
export async function upsertTours(tours: NpsTour[]): Promise<number> {
  if (!tours.length) return 0;
  const rows = tours.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    parkCodes: (t.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
    stops: (t.stops ?? []).map((s, i) => ({
      id: s.id ?? `${t.id}-${i}`,
      ordinal: typeof s.ordinal === 'string' ? Number(s.ordinal) || i : (s.ordinal ?? i),
      assetType: s.assetType ?? null,
      assetId: s.assetId ?? null,
      title: s.title ?? null,
    })),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (tr:Tour {id: row.id}) SET tr.title = row.title, tr.description = row.description, tr.lastSyncedAt = datetime()
    WITH tr, row
    CALL { WITH tr, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (tr)-[:IN_PARK]->(p) }
    CALL {
      WITH tr, row
      UNWIND row.stops AS st
      MERGE (ts:TourStop {id: st.id})
        SET ts.ordinal = toInteger(st.ordinal), ts.title = st.title, ts.assetType = st.assetType
      MERGE (tr)-[:HAS_STOP]->(ts)
      WITH ts, st
      CALL { WITH ts, st WITH ts, st WHERE st.assetType = 'Place' MATCH (pl:Place {id: st.assetId}) MERGE (ts)-[:AT]->(pl) }
      CALL { WITH ts, st WITH ts, st WHERE st.assetType = 'Campground' MATCH (c:Campground {id: st.assetId}) MERGE (ts)-[:AT]->(c) }
      CALL { WITH ts, st WITH ts, st WHERE st.assetType = 'VisitorCenter' MATCH (v:VisitorCenter {id: st.assetId}) MERGE (ts)-[:AT]->(v) }
    }
    RETURN count(tr) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/**
 * Amenity bridges from `/amenities/parksplaces` or `/amenities/parksvisitorcenters`: link existing
 * `:Place`/`:VisitorCenter` nodes to the shared `:Amenity` vocabulary. Each item is an amenity with a
 * `parks[]`, each park holding a child array (`places` or `visitorCenters`).
 */
/**
 * Parse `/amenities/parksplaces|parksvisitorcenters` items into `{amenityId, amenityName, childIds}`.
 * Pure (unit-tested). NPS wraps each amenity object in a single-element array (`data: [[{…}], …]`), so
 * we flatten one level first; each amenity then has `parks[].<childArrayKey>[].id` (the child key is
 * lowercase: `places` / `visitorcenters`). Falls back to the first array-of-{id} on a park object as a
 * guard against future key/casing changes.
 */
export function extractAmenityChildIds(
  items: unknown[],
  childArrayKey: 'places' | 'visitorcenters',
): { amenityId: string; amenityName: string; childIds: string[] }[] {
  const flat = items.flatMap((it) => (Array.isArray(it) ? it : [it])) as Record<string, unknown>[];
  return flat
    .filter((it) => it && typeof it === 'object' && it.id != null)
    .map((it) => {
      const childIds: string[] = [];
      for (const park of (it.parks as Record<string, unknown>[]) ?? []) {
        let arr = park[childArrayKey] as { id?: string }[] | undefined;
        if (!Array.isArray(arr) || arr.length === 0) {
          arr = Object.values(park).find(
            (v): v is { id?: string }[] =>
              Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && 'id' in (v[0] as object),
          );
        }
        for (const child of arr ?? []) if (child?.id) childIds.push(String(child.id));
      }
      return { amenityId: String(it.id), amenityName: String(it.name ?? ''), childIds };
    });
}

export async function upsertAmenityBridges(
  items: NpsGeneric[],
  childLabel: 'Place' | 'VisitorCenter',
  childArrayKey: 'places' | 'visitorcenters',
): Promise<{ amenities: number; refs: number; edges: number }> {
  if (!items.length) return { amenities: 0, refs: 0, edges: 0 };
  const rows = extractAmenityChildIds(items, childArrayKey);
  if (!rows.length) return { amenities: 0, refs: 0, edges: 0 };
  const refs = rows.reduce((n, row) => n + row.childIds.length, 0);
  // OPTIONAL MATCH + FOREACH so amenities are still counted when a child id doesn't resolve, and
  // `edges` reflects only the links actually created — distinguishing a parse miss (refs=0) from an
  // id-match miss (refs>0, edges=0).
  const r = await writeGraph<{ amenities: number; edges: number }>(
    `
    UNWIND $rows AS row
    MERGE (am:Amenity {id: row.amenityId}) SET am.name = coalesce(am.name, row.amenityName)
    WITH am, row
    UNWIND (CASE WHEN size(row.childIds) = 0 THEN [null] ELSE row.childIds END) AS cid
    OPTIONAL MATCH (child:\`${childLabel}\` {id: cid})
    FOREACH (_ IN CASE WHEN child IS NULL THEN [] ELSE [1] END | MERGE (child)-[:HAS_AMENITY]->(am))
    RETURN count(DISTINCT am) AS amenities, count(child) AS edges
    `,
    { rows },
  );
  return { amenities: r[0]?.amenities ?? 0, refs, edges: r[0]?.edges ?? 0 };
}

/** Passport stamps: `(:PassportStamp)-[:IN_PARK]->(:Park)` — the collection/gamification graph. */
export async function upsertPassportStamps(stamps: NpsPassportStamp[]): Promise<number> {
  if (!stamps.length) return 0;
  const rows = stamps.map((s) => ({
    id: s.id,
    label: s.label ?? '',
    parkCodes: (s.parks ?? []).map((p) => p.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (st:PassportStamp {id: row.id}) SET st.label = row.label, st.lastSyncedAt = datetime()
    WITH st, row
    CALL { WITH st, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (st)-[:IN_PARK]->(p) }
    RETURN count(st) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/**
 * Normalize a `/parkinglots` accessibility blob into a wheelchair flag. Pure (unit-tested) — mirrors
 * the campground accessibility normalizer so the same REQUIRES/explain logic works for lots.
 */
export function normalizeParkingAccessibility(acc: Record<string, unknown> | undefined): {
  wheelchairAccessible: boolean;
} {
  const a = acc ?? {};
  const text = [a.wheelchairAccess, a.adaInfo, a.isLotAccessibleToDisabled, a.accessRoads]
    .filter((x) => typeof x === 'string')
    .join(' ');
  const bool = a.isLotAccessibleToDisabled === true || a.isLotAccessibleToDisabled === 'true';
  return { wheelchairAccessible: bool || (/accessible|wheelchair|ada/i.test(text) && !/not accessible/i.test(text)) };
}

/** Parking lots: `(:ParkingLot)-[:IN_PARK]->(:Park)` with a normalized accessibility flag. */
export async function upsertParkingLots(lots: NpsParkingLot[]): Promise<number> {
  if (!lots.length) return 0;
  const rows = lots.map((l) => ({
    id: l.id,
    name: l.name ?? '',
    lat: num(l.latitude),
    lng: num(l.longitude),
    wheelchairAccessible: normalizeParkingAccessibility(l.accessibility).wheelchairAccessible,
    parkCodes: (l.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (pl:ParkingLot {id: row.id})
      SET pl.name = row.name, pl.wheelchairAccessible = row.wheelchairAccessible,
          pl.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                             THEN point({latitude: row.lat, longitude: row.lng}) ELSE pl.location END,
          pl.lastSyncedAt = datetime()
    WITH pl, row
    CALL { WITH pl, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (pl)-[:IN_PARK]->(p) }
    RETURN count(pl) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/** Articles: `(:Article)-[:ABOUT]->(:Park)` — "learn more" content depth (P3). */
export async function upsertArticles(articles: NpsArticle[]): Promise<number> {
  if (!articles.length) return 0;
  const rows = articles.map((a) => ({
    id: a.id,
    title: a.title ?? '',
    url: a.url ?? null,
    description: a.listingDescription ?? null,
    image: (a.images ?? [])[0]?.url ?? null,
    parkCodes: (a.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (ar:Article {id: row.id})
      SET ar.title = row.title, ar.url = row.url, ar.description = row.description, ar.image = row.image,
          ar.lastSyncedAt = datetime()
    WITH ar, row
    CALL { WITH ar, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (ar)-[:ABOUT]->(p) }
    RETURN count(ar) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/**
 * Entrance passes (`OFFERS_PASS`) — derived from the already-synced `Park.entrancePasses` JSON (no
 * extra rate-limited NPS fetch). Also seeds the canonical national "America the Beautiful" annual pass
 * used by the trip cost / break-even model (P2). Idempotent.
 */
export async function upsertEntrancePasses(): Promise<number> {
  await writeGraph(
    `MERGE (e:EntrancePass {id: 'atb-annual'})
       SET e.name = 'America the Beautiful – Annual Pass', e.cost = 80.0, e.scope = 'national'`,
  );
  const parks = await readGraph<{ parkCode: string; passes: string | null }>(
    `MATCH (p:Park) WHERE p.entrancePasses IS NOT NULL AND p.entrancePasses <> '[]'
     RETURN p.parkCode AS parkCode, p.entrancePasses AS passes`,
  );
  const rows: { id: string; parkCode: string; name: string; cost: number | null; description: string | null }[] = [];
  for (const pk of parks) {
    let arr: { cost?: string; title?: string; description?: string }[] = [];
    try {
      arr = pk.passes ? JSON.parse(pk.passes) : [];
    } catch {
      arr = [];
    }
    for (const pass of arr) {
      if (!pass?.title) continue;
      const cost = Number(pass.cost);
      rows.push({
        id: `${pk.parkCode}:${pass.title}`,
        parkCode: pk.parkCode,
        name: pass.title,
        cost: Number.isFinite(cost) ? cost : null,
        description: pass.description ?? null,
      });
    }
  }
  if (!rows.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (e:EntrancePass {id: row.id})
      SET e.name = row.name, e.cost = row.cost, e.description = row.description, e.scope = 'park'
    WITH e, row MATCH (p:Park {parkCode: row.parkCode}) MERGE (p)-[:OFFERS_PASS]->(e)
    RETURN count(e) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}
