import { writeGraph, readGraph } from '../neo4j';
import { STATE_NAMES } from '../us-states';
import {
  parseOperatingHours,
  deriveOpenSeasons,
  summarizeClosures,
  type HoursSchedule,
} from './hours';
import { deriveAccessibilityAmenityIds, ACCESS_NAME_BY_ID } from '../datasources/accessibility';
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
  NpsNewsRelease,
  NpsMultimedia,
  NpsLessonPlan,
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

/** Extract a primary phone + email from an NPS `contacts` blob (bonus: "call ahead"). Pure (unit-tested). */
export function extractContacts(contacts: unknown): { phone: string | null; email: string | null } {
  const c = (contacts ?? {}) as Record<string, unknown>;
  const phones = (Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []) as Record<string, unknown>[];
  const emails = (Array.isArray(c.emailAddresses) ? c.emailAddresses : []) as Record<string, unknown>[];
  const phone = phones.find((p) => typeof p?.phoneNumber === 'string' && p.phoneNumber);
  const email = emails.find((e) => typeof e?.emailAddress === 'string' && e.emailAddress);
  return {
    phone: phone ? (phone.phoneNumber as string) : null,
    email: email ? (email.emailAddress as string) : null,
  };
}

/**
 * Generic operating-hours writer (plan F1, Shared Primitive A; reused by F3 campgrounds / F10 parking):
 * `(:owner)-[:HAS_HOURS]->(:OperatingHours)-[:HAS_EXCEPTION]->(:HoursException)`. `ownerLabel`/
 * `ownerKeyProp` select the owner node (e.g. 'Park'/'parkCode', 'Campground'/'id'). Idempotent;
 * exception dates stored as real `date()`. Existing hours for each owner are rebuilt from the current
 * schedules so stale schedules/exceptions are removed when upstream payloads shrink.
 */
export async function upsertOperatingHoursForOwners(
  ownerLabel: 'Park' | 'Campground' | 'VisitorCenter' | 'ParkingLot',
  ownerKeyProp: 'parkCode' | 'id',
  rows: { ownerKey: string; schedules: HoursSchedule[] }[],
): Promise<number> {
  if (!rows.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MATCH (o:\`${ownerLabel}\` {\`${ownerKeyProp}\`: row.ownerKey})
    CALL {
      WITH o
      OPTIONAL MATCH (o)-[:HAS_HOURS]->(oldH:OperatingHours)
      OPTIONAL MATCH (oldH)-[:HAS_EXCEPTION]->(oldE:HoursException)
      WITH collect(DISTINCT oldE) AS oldEs, collect(DISTINCT oldH) AS oldHs
      FOREACH (e IN oldEs | DETACH DELETE e)
      FOREACH (h IN oldHs | DETACH DELETE h)
      RETURN 0 AS _
    }
    CALL {
      WITH o, row
      UNWIND row.schedules AS sch
      MERGE (h:OperatingHours {id: sch.id})
        SET h.name = sch.name, h.allYear = sch.allYear,
            h.mon = sch.mon, h.tue = sch.tue, h.wed = sch.wed, h.thu = sch.thu,
            h.fri = sch.fri, h.sat = sch.sat, h.sun = sch.sun, h.lastSyncedAt = datetime()
      MERGE (o)-[:HAS_HOURS]->(h)
      WITH h, sch
      UNWIND sch.exceptions AS ex
      MERGE (e:HoursException {id: ex.id})
        SET e.name = ex.name,
            e.startDate = CASE WHEN ex.startDate IS NULL THEN null ELSE date(ex.startDate) END,
            e.endDate = CASE WHEN ex.endDate IS NULL THEN null ELSE date(ex.endDate) END,
            e.mon = ex.mon, e.tue = ex.tue, e.wed = ex.wed, e.thu = ex.thu,
            e.fri = ex.fri, e.sat = ex.sat, e.sun = ex.sun
      MERGE (h)-[:HAS_EXCEPTION]->(e)
    }
    RETURN count(DISTINCT o) AS c
    `,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/**
 * Link entities to canonical accessibility `:Amenity` nodes (plan F5; reuse-:Amenity approach). MERGEs
 * the canonical amenity by deterministic id (so it's robust to taxonomy-seed ordering) and tags it
 * `accessibility=true`. Idempotent. Entities with no accessibility signal are skipped.
 */
export async function linkAccessibilityAmenities(
  ownerLabel: 'Campground' | 'Place' | 'ThingToDo' | 'ParkingLot' | 'VisitorCenter',
  rows: { ownerKey: string; amenityIds: string[] }[],
): Promise<number> {
  const withIds = rows.filter((r) => r.amenityIds.length > 0);
  if (!withIds.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MATCH (o:\`${ownerLabel}\` {id: row.ownerKey})
     UNWIND row.amenityIds AS aid
     MERGE (am:Amenity {id: aid}) SET am.name = coalesce($names[aid], am.name), am.accessibility = true
     MERGE (o)-[:HAS_AMENITY]->(am)
     RETURN count(DISTINCT o) AS c`,
    { rows: withIds, names: ACCESS_NAME_BY_ID },
  );
  return r[0]?.c ?? 0;
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
    phone: extractContacts(p.contacts).phone,
    email: extractContacts(p.contacts).email,
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
          p.contacts = row.contacts, p.phone = row.phone, p.email = row.email,
          p.addresses = row.addresses, p.images = row.images,
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

  // F1: promote operatingHours JSON → nodes, and derive OPEN_IN seasons + a denormalized closure summary.
  const parkHours = parks.map((p) => ({ parkCode: p.parkCode, schedules: parseOperatingHours(p.operatingHours, p.parkCode) }));
  await upsertOperatingHoursForOwners('Park', 'parkCode', parkHours.map((h) => ({ ownerKey: h.parkCode, schedules: h.schedules })));
  const seasonRows = parkHours.map((h) => ({
    parkCode: h.parkCode,
    seasons: deriveOpenSeasons(h.schedules),
    summary: summarizeClosures(h.schedules),
  }));
  await writeGraph(
    `UNWIND $rows AS row
     MATCH (p:Park {parkCode: row.parkCode})
     SET p.seasonalClosureSummary = row.summary
     // re-derive cleanly so a shrunk season set doesn't leave stale OPEN_IN edges
     WITH p, row
     CALL { WITH p OPTIONAL MATCH (p)-[old:OPEN_IN]->(:Season) DELETE old }
     CALL { WITH p, row UNWIND row.seasons AS s MERGE (se:Season {name: s}) MERGE (p)-[:OPEN_IN]->(se) }
     RETURN count(p) AS c`,
    { rows: seasonRows },
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

/** Coerce an NPS count (string|number) to a non-negative integer. Pure. */
function countOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Does an NPS amenity value (string "Yes"/"No" or an array like ["Flush Toilets"]/["None"]) signal presence? Pure. */
function amenityPresent(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => typeof x === 'string' && x.trim() !== '' && !/^none$/i.test(x.trim()));
  if (typeof v === 'string') return /yes/i.test(v) && !/^no\b/i.test(v.trim());
  return false;
}

export interface CampsiteInventory {
  totalSites: number;
  sitesReservable: number;
  sitesFirstCome: number;
  tentSites: number;
  rvSites: number;
  electricSites: number;
  groupSites: number;
  hasDumpStation: boolean;
  hasShowers: boolean;
  hasPotableWater: boolean;
  hasHookups: boolean;
  cellReception: boolean;
}

/**
 * Parse the NPS `/campgrounds` `campsites`/`amenities` objects + reservable counts into structured,
 * filterable inventory (plan F3). Pure (unit-tested). Sub-fields are often 0/empty — normalized to 0/false.
 */
export function extractCampsiteInventory(c: NpsCampground): CampsiteInventory {
  const cs = (c.campsites ?? {}) as Record<string, unknown>;
  const am = (c.amenities ?? {}) as Record<string, unknown>;
  const electricSites = countOf(cs.electricalHookups);
  return {
    totalSites: countOf(cs.totalSites),
    sitesReservable: countOf(c.numberOfSitesReservable),
    sitesFirstCome: countOf(c.numberOfSitesFirstComeFirstServe),
    tentSites: countOf(cs.tentOnly),
    rvSites: countOf(cs.rvOnly),
    electricSites,
    groupSites: countOf(cs.group),
    hasDumpStation: amenityPresent(am.dumpStation),
    hasShowers: amenityPresent(am.showers),
    hasPotableWater: amenityPresent(am.potableWater),
    hasHookups: electricSites > 0,
    cellReception: amenityPresent(am.cellPhoneReception),
  };
}

/** Canonical campground :Amenity nodes (plan F3) — fixes the dead (:Campground)-[:HAS_AMENITY] edge that
 * searchParks/recommend already query. Deterministic ids like the accessibility set. */
const CAMPGROUND_AMENITY_NAMES: Record<string, string> = {
  'amen:dump-station': 'Dump Station',
  'amen:showers': 'Showers',
  'amen:potable-water': 'Potable Water',
  'amen:electrical-hookups': 'Electrical Hookups',
  'amen:cell-reception': 'Cell Reception',
};

function campgroundAmenityIds(inv: CampsiteInventory): string[] {
  const ids: string[] = [];
  if (inv.hasDumpStation) ids.push('amen:dump-station');
  if (inv.hasShowers) ids.push('amen:showers');
  if (inv.hasPotableWater) ids.push('amen:potable-water');
  if (inv.electricSites > 0) ids.push('amen:electrical-hookups');
  if (inv.cellReception) ids.push('amen:cell-reception');
  return ids;
}

export async function upsertCampgrounds(cgs: NpsCampground[]): Promise<number> {
  if (!cgs.length) return 0;
  const rows = cgs.map((c) => {
    const acc = normalizeCampgroundAccessibility(c.accessibility);
    const inv = extractCampsiteInventory(c); // F3 inventory
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
      ...inv,
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
          // F3 inventory props (indexed in migration 013)
          c.totalSites = row.totalSites, c.sitesReservable = row.sitesReservable,
          c.sitesFirstCome = row.sitesFirstCome, c.tentSites = row.tentSites, c.rvSites = row.rvSites,
          c.electricSites = row.electricSites, c.groupSites = row.groupSites,
          c.hasDumpStation = row.hasDumpStation, c.hasShowers = row.hasShowers,
          c.hasPotableWater = row.hasPotableWater, c.hasHookups = row.hasHookups,
          c.cellReception = row.cellReception,
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
  // F1: campground operating hours (shares the OperatingHours model).
  await upsertOperatingHoursForOwners(
    'Campground',
    'id',
    cgs.map((c) => ({ ownerKey: c.id, schedules: parseOperatingHours(c.operatingHours, c.id) })),
  );
  // F5: accessibility amenities derived from the normalized wheelchair flag + adaInfo text.
  await linkAccessibilityAmenities(
    'Campground',
    cgs.map((c) => {
      const acc = normalizeCampgroundAccessibility(c.accessibility);
      return { ownerKey: c.id, amenityIds: deriveAccessibilityAmenityIds({ text: acc.adaInfo, wheelchair: acc.wheelchairAccessible }) };
    }),
  );
  // F3: fix the dead (:Campground)-[:HAS_AMENITY]->(:Amenity) edge that searchParks/recommend query.
  await linkCampgroundAmenities(
    cgs.map((c) => ({ ownerKey: c.id, amenityIds: campgroundAmenityIds(extractCampsiteInventory(c)) })),
  );
  return r[0]?.c ?? 0;
}

/** Link campgrounds to canonical campground :Amenity nodes by deterministic id (plan F3). Idempotent. */
export async function linkCampgroundAmenities(rows: { ownerKey: string; amenityIds: string[] }[]): Promise<number> {
  const withIds = rows.filter((r) => r.amenityIds.length > 0);
  if (!withIds.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MATCH (c:Campground {id: row.ownerKey})
     UNWIND row.amenityIds AS aid
     MERGE (am:Amenity {id: aid}) SET am.name = coalesce($names[aid], am.name)
     MERGE (c)-[:HAS_AMENITY]->(am)
     RETURN count(DISTINCT c) AS c`,
    { rows: withIds, names: CAMPGROUND_AMENITY_NAMES },
  );
  return r[0]?.c ?? 0;
}

/**
 * Derive a trail's length (miles) and elevation gain (feet) from free ThingToDo text. NPS doesn't expose
 * these as first-class fields, so we extract them where the park states them in prose ("a 3.5-mile loop",
 * "1,200 ft of elevation gain"). Pure (unit-tested). Conservative by design — elevation is only taken
 * when an elevation-context word is present, since a bare "850 ft" is ambiguous; both return null when
 * absent so the latent `parkDetail` reads (`lib/queries.ts:126`) stop returning undefined-as-null.
 */
const ELEV_CONTEXT = /\b(elevation|gain|climb|climbs?|ascent|vertical|descend|descent)\b/i;
export function extractTrailMetrics(text: string): {
  lengthMiles: number | null;
  elevationGainFt: number | null;
} {
  if (!text) return { lengthMiles: null, elevationGainFt: null };
  let lengthMiles: number | null = null;
  let elevationGainFt: number | null = null;
  // "3.5 mile", "3.5-mile", "12 miles", "0.5 mi" — first plausible match, capped at 100 mi.
  const mile = text.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:miles?|mi)\b/i);
  if (mile) {
    const v = Number(mile[1]);
    if (Number.isFinite(v) && v > 0 && v <= 100) lengthMiles = v;
  }
  // "1,200 ft", "1200 feet", "850-foot" — only when an elevation-context word is present; capped 30k ft.
  if (ELEV_CONTEXT.test(text)) {
    const elev = text.match(/(\d{1,3}(?:,\d{3})+|\d{2,5})\s*-?\s*(?:ft|feet|foot)\b/i);
    if (elev) {
      const v = Number(elev[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0 && v <= 30000) elevationGainFt = v;
    }
  }
  return { lengthMiles, elevationGainFt };
}

/** NPS yes/no fields arrive as "Yes"/"No" strings (sometimes booleans). Pure. null when unstated. */
export function yesNo(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t.startsWith('yes')) return true;
    if (t.startsWith('no')) return false;
  }
  return null;
}

/** Map an NPS season list (["Spring","Fall"]) to canonical domain Season names. Pure. */
export function normSeasons(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const map: Record<string, string> = { spring: 'spring', summer: 'summer', fall: 'fall', autumn: 'fall', winter: 'winter' };
  return [...new Set(arr.map((s) => map[String(s).trim().toLowerCase()]).filter(Boolean))];
}

/** Trim + de-dupe a string array (timeOfDay / tags). Pure. */
export function normStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

export async function upsertThingsToDo(items: NpsThingToDo[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((t) => {
    // F7: derive length/elevation from the richest text we have (longDescription added via fields=).
    const metrics = extractTrailMetrics(`${t.title ?? ''} ${t.shortDescription ?? ''} ${t.longDescription ?? ''}`);
    return {
      id: t.id,
      title: t.title,
      shortDescription: t.shortDescription ?? null,
      lat: num(t.latitude),
      lng: num(t.longitude),
      lengthMiles: metrics.lengthMiles,
      elevationGainFt: metrics.elevationGainFt,
      // F7 granular planning facets.
      durationText: t.durationDescription ?? t.duration ?? null,
      timeOfDay: normStrings(t.timeOfDay),
      season: normSeasons(t.season),
      petsAllowed: yesNo(t.arePetsPermitted),
      feesApply: yesNo(t.doFeesApply),
      reservationRequired: yesNo(t.isReservationRequired),
      parkCodes: (t.relatedParks ?? []).map((p) => p.parkCode).filter(Boolean),
      activities: (t.activities ?? []).map((a) => ({ id: a.id, name: a.name })),
      topics: (t.topics ?? []).map((x) => ({ id: x.id, name: x.name })),
    };
  });
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (n:ThingToDo {id: row.id})
      SET n.title = row.title, n.shortDescription = row.shortDescription,
          // coalesce so a richer value isn't nulled by a partial re-sync.
          n.lengthMiles = coalesce(row.lengthMiles, n.lengthMiles),
          n.elevationGainFt = coalesce(row.elevationGainFt, n.elevationGainFt),
          n.durationText = coalesce(row.durationText, n.durationText),
          n.timeOfDay = row.timeOfDay, n.season = row.season,
          n.petsAllowed = row.petsAllowed, n.feesApply = row.feesApply,
          n.reservationRequired = row.reservationRequired,
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
    CALL {
      WITH n, row
      UNWIND row.topics AS top
      MERGE (t:Topic {id: top.id}) SET t.name = coalesce(t.name, top.name)
      MERGE (n)-[:RELATES_TO_TOPIC]->(t)
    }
    CALL {
      WITH n, row
      UNWIND row.season AS s
      MERGE (se:Season {name: s}) MERGE (n)-[:BEST_IN]->(se)
    }
    RETURN count(n) AS c
    `,
    { rows },
  );
  // F5: accessibility amenities from the thing-to-do's accessibilityInformation text.
  await linkAccessibilityAmenities(
    'ThingToDo',
    items.map((t) => ({ ownerKey: t.id, amenityIds: deriveAccessibilityAmenityIds({ text: t.accessibilityInformation }) })),
  );
  return r[0]?.c ?? 0;
}

/** Add days to an ISO date (UTC). Pure. */
export function addDaysISO(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Expand an NPS event to concrete occurrence dates within [today, today+horizon] (plan F4). NPS provides
 * a concrete `dates[]` array for recurring events, so we use that (no RRULE math) and fall back to
 * `datestart`. Caps the horizon so CalendarDate materialization stays bounded. Pure (unit-tested).
 */
export function expandEventDates(
  ev: { dates?: unknown; datestart?: unknown },
  todayISO: string,
  horizonDays = 120,
): string[] {
  const horizon = addDaysISO(todayISO, horizonDays);
  const out = new Set<string>();
  const push = (d: unknown) => {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayISO && d <= horizon) out.add(d);
  };
  if (Array.isArray(ev.dates)) ev.dates.forEach(push);
  if (!out.size) push(ev.datestart);
  return [...out].sort();
}

/**
 * Events (plan F4) — enrich the thin sync (title+dates) with category/type/tags/free/registration and
 * materialize concrete `OCCURS_ON->(:CalendarDate)` occurrences (RRULE-free, via NPS `dates[]`). Upsert
 * active=true for this pull, soft-expire the rest. `todayISO` is injected for testability/determinism.
 */
export async function upsertEvents(
  events: NpsGeneric[],
  todayISO: string,
): Promise<{ active: number; expired: number }> {
  const rows = events.map((e) => ({
    id: String(e.id),
    title: String(e.title ?? ''),
    description: (e.description as string) ?? null,
    locationName: (e.location as string) ?? null, // venue text; the point stays on e.location (event_location index)
    category: (e.category as string) ?? null,
    isFree: yesNo(e.isfree),
    regRequired: yesNo(e.isregresrequired),
    regUrl: (e.regresurl as string) || null,
    recurrenceRule: (e.recurrencerule as string) || null,
    dateStart: (e.datestart as string) ?? null,
    dateEnd: (e.dateend as string) ?? null,
    parkCode: (e.sitecode as string) ?? (e.parkCode as string) ?? null,
    lat: e.latitude ? Number(e.latitude) : null,
    lng: e.longitude ? Number(e.longitude) : null,
    types: normStrings(e.types),
    tags: normStrings(e.tags),
    occurrences: expandEventDates(e as { dates?: unknown; datestart?: unknown }, todayISO),
  }));
  const ids = rows.map((r) => r.id);
  const up = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MERGE (e:Event {id: row.id})
       SET e.title = row.title, e.description = row.description, e.locationName = row.locationName,
           e.category = row.category, e.isFree = row.isFree, e.regRequired = row.regRequired,
           e.regUrl = row.regUrl, e.recurrenceRule = row.recurrenceRule,
           e.dateStart = row.dateStart, e.dateEnd = row.dateEnd, e.active = true,
           e.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                             THEN point({latitude: row.lat, longitude: row.lng}) ELSE e.location END,
           e.lastSyncedAt = datetime()
     WITH e, row
     CALL { WITH e, row WITH e, row WHERE row.parkCode IS NOT NULL
       MATCH (p:Park {parkCode: row.parkCode}) MERGE (e)-[:HELD_AT]->(p) }
     CALL { WITH e, row UNWIND row.types AS t
       MERGE (et:EventType {name: t}) MERGE (e)-[:OF_TYPE]->(et) }
     CALL { WITH e, row UNWIND row.tags AS tg
       OPTIONAL MATCH (tp:Topic {name: tg}) FOREACH (_ IN CASE WHEN tp IS NULL THEN [] ELSE [1] END | MERGE (e)-[:TAGGED]->(tp)) }
     CALL { WITH e OPTIONAL MATCH (e)-[old:OCCURS_ON]->(:CalendarDate) DELETE old }
     CALL { WITH e, row UNWIND row.occurrences AS d
       MERGE (cd:CalendarDate {date: date(d)}) MERGE (e)-[:OCCURS_ON]->(cd) }
     RETURN count(e) AS c`,
    { rows },
  );
  const exp = await writeGraph<{ c: number }>(
    `MATCH (e:Event) WHERE e.active = true AND NOT e.id IN $ids SET e.active = false RETURN count(e) AS c`,
    { ids },
  );
  return { active: up[0]?.c ?? 0, expired: exp[0]?.c ?? 0 };
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
  // F1: visitor-center operating hours (shares the OperatingHours model).
  await upsertOperatingHoursForOwners(
    'VisitorCenter',
    'id',
    items.map((v) => ({ ownerKey: String(v.id), schedules: parseOperatingHours(v.operatingHours, String(v.id)) })),
  );
  // F5: VC accessibility from its accessibility.wheelchairAccess text (avoid matching object key names).
  await linkAccessibilityAmenities(
    'VisitorCenter',
    items.map((v) => {
      const acc = (v.accessibility ?? {}) as Record<string, unknown>;
      const text = typeof acc.wheelchairAccess === 'string' ? acc.wheelchairAccess : null;
      return { ownerKey: String(v.id), amenityIds: deriveAccessibilityAmenityIds({ text }) };
    }),
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
  // F5: a place with an audio description offers the "Audio Description" accessibility amenity.
  await linkAccessibilityAmenities(
    'Place',
    places.map((p) => ({ ownerKey: p.id, amenityIds: deriveAccessibilityAmenityIds({ audioDescription: !!p.audioDescription }) })),
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
      audioUrl: s.audioFileUrl ?? null, // F6: self-guided audio per stop
      transcript: s.transcript ?? null,
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
        SET ts.ordinal = toInteger(st.ordinal), ts.title = st.title, ts.assetType = st.assetType,
            ts.audioUrl = st.audioUrl, ts.transcript = st.transcript
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
      const parks = Array.isArray(it.parks) ? it.parks : [];
      for (const park of parks) {
        if (!park || typeof park !== 'object') continue;
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

  // 1) MERGE the amenity vocabulary in one modest transaction (≈127 rows).
  await writeGraph(
    `UNWIND $amenities AS a
     MERGE (am:Amenity {id: a.id})
     SET am.name = CASE
       WHEN trim(coalesce(a.name, '')) <> '' THEN a.name
       ELSE am.name
     END`,
    {
    amenities: rows.map((r) => ({ id: r.amenityId, name: r.amenityName })),
    },
  );

  // 2) Create HAS_AMENITY edges in BATCHES. A single UNWIND over all amenities × parks × places is a
  // huge cartesian that blows past Neo4j's per-transaction memory cap (dbms.memory.transaction.total.max),
  // so we flatten to (amenity, child) pairs and write fixed-size chunks. `edges` counts only matched
  // children, so refs>0 & edges=0 would still flag an id mismatch.
  const pairs: { amenityId: string; cid: string }[] = [];
  for (const row of rows) for (const cid of row.childIds) pairs.push({ amenityId: row.amenityId, cid });
  const refs = pairs.length;
  let edges = 0;
  const BATCH = 2000;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const res = await writeGraph<{ edges: number }>(
      `
      UNWIND $batch AS row
      MATCH (am:Amenity {id: row.amenityId})
      MATCH (child:\`${childLabel}\` {id: row.cid})
      MERGE (child)-[:HAS_AMENITY]->(am)
      RETURN count(*) AS edges
      `,
      { batch: pairs.slice(i, i + BATCH) },
    );
    edges += res[0]?.edges ?? 0;
  }
  return { amenities: new Set(rows.map((r) => r.amenityId)).size, refs, edges };
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
/**
 * Parse static parking-lot detail (plan F10): accessible-space count, EV-charging flag (from name/desc
 * text), and whether live availability data exists. Pure (unit-tested). Live counts are NOT stored (a
 * runtime concern), only the `hasLiveData` flag. Drive-time/availability is best-effort.
 */
export function extractParkingDetail(l: NpsParkingLot): {
  accessibleSpaces: number;
  hasEvCharging: boolean;
  hasLiveData: boolean;
} {
  const acc = (l.accessibility ?? {}) as Record<string, unknown>;
  const text = `${l.name ?? ''} ${l.description ?? ''}`;
  return {
    accessibleSpaces: countOf(acc.numberofadaspaces ?? acc.totalSpaces ?? acc.adaSpaces),
    hasEvCharging: /\b(ev charging|electric vehicle|charging station|ev charger)\b/i.test(text),
    hasLiveData: !!l.livedata && typeof l.livedata === 'object' && Object.keys(l.livedata).length > 0,
  };
}

export async function upsertParkingLots(lots: NpsParkingLot[]): Promise<number> {
  if (!lots.length) return 0;
  const rows = lots.map((l) => {
    const d = extractParkingDetail(l);
    return {
      id: l.id,
      name: l.name ?? '',
      lat: num(l.latitude),
      lng: num(l.longitude),
      wheelchairAccessible: normalizeParkingAccessibility(l.accessibility).wheelchairAccessible,
      accessibleSpaces: d.accessibleSpaces,
      hasEvCharging: d.hasEvCharging,
      hasLiveData: d.hasLiveData,
      parkCodes: (l.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
    };
  });
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (pl:ParkingLot {id: row.id})
      SET pl.name = row.name, pl.wheelchairAccessible = row.wheelchairAccessible,
          pl.accessibleSpaces = row.accessibleSpaces, pl.hasEvCharging = row.hasEvCharging,
          pl.hasLiveData = row.hasLiveData,
          pl.location = CASE WHEN row.lat IS NOT NULL AND row.lng IS NOT NULL
                             THEN point({latitude: row.lat, longitude: row.lng}) ELSE pl.location END,
          pl.lastSyncedAt = datetime()
    WITH pl, row
    CALL { WITH pl, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (pl)-[:IN_PARK]->(p) }
    RETURN count(pl) AS c
    `,
    { rows },
  );
  // F1: parking-lot operating hours (shares the OperatingHours model).
  await upsertOperatingHoursForOwners(
    'ParkingLot',
    'id',
    lots.map((l) => ({ ownerKey: l.id, schedules: parseOperatingHours(l.operatingHours, l.id) })),
  );
  // F5: an accessible parking lot offers the "Accessible Parking" amenity.
  await linkAccessibilityAmenities(
    'ParkingLot',
    lots.map((l) => ({
      ownerKey: l.id,
      amenityIds: normalizeParkingAccessibility(l.accessibility).wheelchairAccessible ? ['amen:accessible-parking'] : [],
    })),
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
    // Latent-bug fix (plan F8/Sprint 0): write the full body so the `article_fulltext`/`article_embedding`
    // indexes (migration 001) stop being empty. coalesce on re-sync so a body is never nulled out.
    body: a.bodyText ?? null,
    image: (a.images ?? [])[0]?.url ?? null,
    parkCodes: (a.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `
    UNWIND $rows AS row
    MERGE (ar:Article {id: row.id})
      SET ar.title = row.title, ar.url = row.url, ar.description = row.description, ar.image = row.image,
          ar.body = coalesce(row.body, ar.body),
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
 * Classify an NPS entrance-fee title into a billing unit for the trip-budget model (plan F2). Pure
 * (unit-tested). NPS titles look like "Entrance - Private Vehicle" / "Entrance - Motorcycle" /
 * "Entrance - Per Person".
 */
export function parseFeeUnit(title: string): 'vehicle' | 'person' | 'motorcycle' | 'other' {
  const t = (title ?? '').toLowerCase();
  if (/motorcycle/.test(t)) return 'motorcycle';
  if (/per person|per-person|individual|on foot|bicycle|cyclist|hiker|pedestrian/.test(t)) return 'person';
  if (/vehicle|\bcar\b|automobile/.test(t)) return 'vehicle';
  return 'other';
}

/**
 * Entrance fees (`CHARGES`, plan F2) — derived from the already-synced `Park.entranceFees` JSON (no extra
 * NPS fetch), as `(:Park)-[:CHARGES]->(:EntranceFee {cost:float, unit})` so the trip-budget model can sum
 * by vehicle type and filter on a budget. Idempotent. Stale fees for a park are cleared first so a price
 * change doesn't leave a duplicate.
 */
export async function upsertEntranceFees(): Promise<number> {
  const parks = await readGraph<{ parkCode: string; fees: string | null }>(
    `MATCH (p:Park) WHERE p.entranceFees IS NOT NULL AND p.entranceFees <> '[]'
     RETURN p.parkCode AS parkCode, p.entranceFees AS fees`,
  );
  const rows: { id: string; parkCode: string; title: string; cost: number | null; unit: string; description: string | null }[] = [];
  for (const pk of parks) {
    let arr: { cost?: string; title?: string; description?: string }[] = [];
    try {
      arr = pk.fees ? JSON.parse(pk.fees) : [];
    } catch {
      arr = [];
    }
    for (const fee of arr) {
      if (!fee?.title) continue;
      const cost = Number(fee.cost);
      rows.push({
        id: `${pk.parkCode}:${fee.title}`,
        parkCode: pk.parkCode,
        title: fee.title,
        cost: Number.isFinite(cost) ? cost : null,
        unit: parseFeeUnit(fee.title),
        description: fee.description ?? null,
      });
    }
  }
  await writeGraph(`MATCH (f:EntranceFee) DETACH DELETE f`);
  if (!rows.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MATCH (p:Park {parkCode: row.parkCode})
     MERGE (f:EntranceFee {id: row.id})
       SET f.title = row.title, f.cost = row.cost, f.unit = row.unit, f.description = row.description
     MERGE (p)-[:CHARGES]->(f)
     RETURN count(DISTINCT f) AS c`,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/**
 * Multimedia (F6): `(:AudioFile|:Gallery|:Video)-[:ABOUT]->(:Park)`. One generic upsert for the three —
 * audio/video carry duration + transcript, galleries carry assetCount. Gated behind SYNC_MULTIMEDIA=1 at
 * the caller. Idempotent.
 */
export async function upsertMultimedia(
  label: 'AudioFile' | 'Gallery' | 'Video',
  items: NpsMultimedia[],
): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((m) => ({
    id: m.id,
    title: m.title ?? '',
    url: m.permalinkUrl ?? null,
    durationMs: m.durationMs != null && m.durationMs !== '' ? Number(m.durationMs) : null,
    transcript: m.transcript ?? null,
    assetCount: m.assetCount != null && m.assetCount !== '' ? Number(m.assetCount) : null,
    parkCodes: (m.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MERGE (m:\`${label}\` {id: row.id})
       SET m.title = row.title, m.url = row.url, m.durationMs = row.durationMs,
           m.transcript = row.transcript, m.assetCount = row.assetCount, m.lastSyncedAt = datetime()
     WITH m, row
     CALL { WITH m, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (m)-[:ABOUT]->(p) }
     RETURN count(m) AS c`,
    { rows },
  );
  return r[0]?.c ?? 0;
}


const GRADE_WORDS: Record<string, number> = {
  kindergarten: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

/**
 * Parse an NPS lesson `gradeLevel` ("Sixth Grade-Eighth Grade", "6-8", "Grade 4") into a numeric band
 * (K=0…12) so courses can be filtered/grouped by grade. Pure (unit-tested). Returns nulls when unknown.
 */
export function parseGradeBand(gradeLevel: string | null | undefined): { min: number | null; max: number | null } {
  if (!gradeLevel) return { min: null, max: null };
  const grades: number[] = [];
  for (const m of gradeLevel.toLowerCase().matchAll(/\b(kindergarten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b/g)) {
    grades.push(GRADE_WORDS[m[1]]);
  }
  for (const m of gradeLevel.matchAll(/\b(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 12) grades.push(n);
  }
  if (!grades.length) return { min: null, max: null };
  return { min: Math.min(...grades), max: Math.max(...grades) };
}

/**
 * Lesson plans (educator content for "Ranger School"): `(:LessonPlan)-[:ABOUT]->(:Park)` + RELATES_TO_TOPIC.
 * Captures the essential question, objective, duration, grade band, standards, and image so the courseware
 * can build park-grounded lessons. Idempotent.
 */
export async function upsertLessonPlans(items: NpsLessonPlan[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((l) => {
    const band = parseGradeBand(l.gradeLevel);
    const gradeBandId = band.min != null && band.max != null ? `${band.min}-${band.max}` : null;
    return {
      id: l.id,
      title: l.title ?? '',
      url: l.url ?? null,
      gradeLevel: l.gradeLevel ?? null,
      gradeMin: band.min,
      gradeMax: band.max,
      gradeBandId,
      gradeBandLabel: gradeBandId ? `Grades ${band.min}–${band.max}` : null,
      subject: l.subject ?? null,
      objective: l.questionObjective ?? l.objective ?? null,
      durationMin: countOf(l.durationInMinutes) || null,
      standards: l.commonCore ?? null,
      image: l.image?.url ?? (l.images ?? [])[0]?.url ?? null,
      parkCodes: (l.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
      topics: (l.topics ?? []).map((t) => ({ id: t.id, name: t.name })),
    };
  });
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MERGE (lp:LessonPlan {id: row.id})
       SET lp.title = row.title, lp.url = row.url, lp.gradeLevel = row.gradeLevel,
           lp.gradeMin = row.gradeMin, lp.gradeMax = row.gradeMax, lp.subject = row.subject,
           lp.objective = row.objective, lp.durationMin = row.durationMin, lp.standards = row.standards,
           lp.image = row.image, lp.lastSyncedAt = datetime()
     WITH lp, row
     CALL { WITH lp, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (lp)-[:ABOUT]->(p) }
     CALL { WITH lp, row UNWIND row.topics AS top MERGE (t:Topic {id: top.id}) SET t.name = coalesce(t.name, top.name) MERGE (lp)-[:RELATES_TO_TOPIC]->(t) }
     CALL { WITH lp, row WITH lp, row WHERE row.gradeBandId IS NOT NULL
            MERGE (gb:GradeBand {id: row.gradeBandId}) SET gb.min = row.gradeMin, gb.max = row.gradeMax, gb.label = row.gradeBandLabel
            MERGE (lp)-[:TARGETS]->(gb) }
     RETURN count(lp) AS c`,
    { rows },
  );
  return r[0]?.c ?? 0;
}

/** Normalize an NPS releasedate ("2026-06-20 00:00:00.0") to ISO YYYY-MM-DD, or null. Pure (unit-tested). */
export function parseReleaseDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * News releases (F8): `(:NewsRelease {releaseDate:date})-[:ABOUT]->(:Park)`. Timely content for digests +
 * "Latest from this park". `abstract` feeds the newsrelease_fulltext index. Idempotent.
 */
export async function upsertNewsReleases(items: NpsNewsRelease[]): Promise<number> {
  if (!items.length) return 0;
  const rows = items.map((n) => ({
    id: n.id,
    title: n.title ?? '',
    abstract: n.abstract ?? null,
    url: n.url ?? null,
    image: n.image?.url ?? (n.images ?? [])[0]?.url ?? null,
    releaseDate: parseReleaseDate(n.releasedate),
    parkCodes: (n.relatedParks ?? []).map((rp) => rp.parkCode).filter(Boolean),
  }));
  const r = await writeGraph<{ c: number }>(
    `UNWIND $rows AS row
     MERGE (nr:NewsRelease {id: row.id})
       SET nr.title = row.title, nr.abstract = row.abstract, nr.url = row.url, nr.image = row.image,
           nr.releaseDate = CASE WHEN row.releaseDate IS NULL THEN null ELSE date(row.releaseDate) END,
           nr.lastSyncedAt = datetime()
     WITH nr, row
     CALL { WITH nr, row UNWIND row.parkCodes AS pc MATCH (p:Park {parkCode: pc}) MERGE (nr)-[:ABOUT]->(p) }
     RETURN count(nr) AS c`,
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
