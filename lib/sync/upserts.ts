import { writeGraph } from '../neo4j';
import { STATE_NAMES } from '../us-states';
import type {
  NpsAlert,
  NpsCampground,
  NpsPark,
  NpsThingToDo,
  NpsActivityRef,
  NpsGeneric,
} from '../nps';

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
  const rows = cgs.map((c) => ({
    id: c.id,
    name: c.name,
    parkCode: c.parkCode,
    description: c.description ?? null,
    reservationUrl: c.reservationUrl ?? null,
    lat: num(c.latitude),
    lng: num(c.longitude),
    amenities: j(c.amenities ?? {}),
    accessibility: j(c.accessibility ?? {}),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (c:Campground {id: row.id})
      SET c.name = row.name, c.description = row.description, c.reservationUrl = row.reservationUrl,
          c.amenities = row.amenities, c.accessibility = row.accessibility,
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
