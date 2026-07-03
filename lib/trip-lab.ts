import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { getTrip, tripCost, checkTripAlerts, recomputeSegments } from './trips';
import { parkDetail } from './queries';
import { getAstro } from './datasources';

/**
 * Trip Lab (ADR-056/057) — fork a saved trip, diff two trips side-by-side, and produce field-ready
 * outputs (printable brief + offline pack). Builds on the existing trip service (`lib/trips.ts`): forks
 * deep-clone the :Stop subgraph with a parentId/version lineage; the diff composes drive / dark-hours /
 * cost / risk from graph + ephemeris only (no external API), so it's fast and deterministic-ish.
 */

// ---- pure helpers (unit-tested) ------------------------------------------------------------------

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Add whole days to a YYYY-MM-DD string, returning YYYY-MM-DD. UTC to stay tz-stable. */
export function addDaysIso(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Max private-vehicle entrance fee from the synced `entranceFees` array (≈ the line we charge). */
export function maxFee(fees: { cost?: string | number }[] | null | undefined): number {
  if (!fees?.length) return 0;
  return fees.reduce((max, f) => Math.max(max, Number(f.cost) || 0), 0);
}

/** Active Closure/Danger alert load → a normalized 0–3 risk score + label. Pure. */
export function riskFromAlerts(alertCount: number): { score: number; label: 'none' | 'low' | 'moderate' | 'high' } {
  const score = alertCount === 0 ? 0 : alertCount <= 1 ? 1 : alertCount <= 3 ? 2 : 3;
  return { score, label: (['none', 'low', 'moderate', 'high'] as const)[score] };
}

// ---- fork ----------------------------------------------------------------------------------------

/**
 * Deep-clone a trip into a new fork: copies the Trip props + every :Stop (order/day/nights/name/location)
 * and its OF_* edges, sets `parentId` + bumped `version` for lineage, then rebuilds DRIVE_TO segments.
 * userId-scoped (R4). Returns the new trip id, or null if the source isn't the caller's.
 */
export async function forkTrip(userId: string, tripId: string, name?: string): Promise<string | null> {
  const owns = await readGraph<{ name: string }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId}) RETURN t.name AS name`,
    { userId, tripId },
  );
  if (!owns.length) return null;
  const newId = randomUUID();
  const forkName = name?.trim() || `${owns[0].name} (copy)`;

  // 1) clone the trip node + lineage + PLANNED edge
  await writeGraph(
    `
    MATCH (orig:Trip {id:$tripId, userId:$userId})
    MERGE (u:User {userId:$userId})
    CREATE (f:Trip {id:$newId, userId:$userId})
      SET f.name = $name, f.startDate = orig.startDate, f.endDate = orig.endDate,
          f.startPoint = orig.startPoint, f.startLabel = orig.startLabel,
          f.returnToOrigin = orig.returnToOrigin, f.endPoint = orig.endPoint,
          f.parentId = orig.id, f.version = coalesce(orig.version, 1) + 1, f.createdAt = datetime()
    MERGE (u)-[:PLANNED]->(f)
    `,
    { userId, tripId, newId, name: forkName },
  );

  // 2) clone stops + OF_* edges (randomUUID() is a Neo4j 5 function; FOREACH copies only present edges)
  await writeGraph(
    `
    MATCH (orig:Trip {id:$tripId, userId:$userId})-[:HAS_STOP]->(s:Stop)
    MATCH (f:Trip {id:$newId, userId:$userId})
    WITH f, s ORDER BY s.order ASC
    CREATE (f)-[:HAS_STOP]->(ns:Stop {id: randomUUID()})
      SET ns.order = s.order, ns.kind = s.kind, ns.day = s.day, ns.nights = s.nights,
          ns.name = s.name, ns.location = s.location
    WITH ns, s
    OPTIONAL MATCH (s)-[:OF_PARK]->(p:Park)
      FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | MERGE (ns)-[:OF_PARK]->(p))
    WITH ns, s
    OPTIONAL MATCH (s)-[:OF_CAMPGROUND]->(c:Campground)
      FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END | MERGE (ns)-[:OF_CAMPGROUND]->(c))
    WITH ns, s
    OPTIONAL MATCH (s)-[:OF_POI]->(poi:ThingToDo)
      FOREACH (_ IN CASE WHEN poi IS NULL THEN [] ELSE [1] END | MERGE (ns)-[:OF_POI]->(poi))
    WITH ns, s
    OPTIONAL MATCH (s)-[:OF_PLACE]->(pl:Place)
      FOREACH (_ IN CASE WHEN pl IS NULL THEN [] ELSE [1] END | MERGE (ns)-[:OF_PLACE]->(pl))
    `,
    { userId, tripId, newId },
  );

  await recomputeSegments(userId, newId).catch(() => {});
  return newId;
}

// ---- metrics + diff ------------------------------------------------------------------------------

export interface TripMetrics {
  tripId: string;
  name: string;
  version: number;
  parentId: string | null;
  stops: number;
  parks: number;
  driveMiles: number;
  driveMinutes: number;
  darkHoursTotal: number | null;
  darkHoursAvg: number | null;
  costTotal: number;
  alertCount: number;
  riskScore: number;
  riskLabel: 'none' | 'low' | 'moderate' | 'high';
}

/** One trip's comparable metrics: drive (graph), dark hours (ephemeris), cost (graph), risk (alerts).
 * `skipAlerts` skips the only external call (checkTripAlerts → NPS) for a cheap before/after snapshot on an
 * incremental edit (P1.1) — risk then reports `none`/0, so reserve it for low-stakes diffs, not compare_trips. */
export async function tripMetrics(
  userId: string,
  tripId: string,
  opts: { skipAlerts?: boolean } = {},
): Promise<TripMetrics | null> {
  const trip = await getTrip(userId, tripId);
  if (!trip) return null;
  const meta = await readGraph<{ version: number; parentId: string | null }>(
    `MATCH (t:Trip {id:$tripId, userId:$userId}) RETURN coalesce(t.version, 1) AS version, t.parentId AS parentId`,
    { userId, tripId },
  );
  const stops = (trip.stops ?? []).filter(Boolean) as NonNullable<typeof trip.stops>;
  // Stop-to-stop DRIVE_TO plus the origin legs (home → first stop / last stop → home on a round trip).
  const legMiles = (trip.originLeg?.miles ?? 0) + (trip.returnLeg?.miles ?? 0);
  const legMinutes = (trip.originLeg?.minutes ?? 0) + (trip.returnLeg?.minutes ?? 0);
  const driveMiles = round1(stops.reduce((s, st) => s + (st.driveTo?.miles ?? 0), 0) + legMiles);
  const driveMinutes = Math.round(stops.reduce((s, st) => s + (st.driveTo?.minutes ?? 0), 0) + legMinutes);

  const start = trip.startDate ? trip.startDate.slice(0, 10) : undefined;
  const parkStops = stops.filter((s) => s.kind === 'park' && s.lat != null && s.lng != null);
  let darkTotal = 0;
  let darkN = 0;
  for (const s of parkStops) {
    const date = start ? addDaysIso(start, (s.day ?? 1) - 1) : undefined;
    const h = getAstro(s.lat as number, s.lng as number, date).darkHours.hours;
    if (h != null) {
      darkTotal += h;
      darkN++;
    }
  }

  const cost = await tripCost(userId, tripId);
  let alertCount = 0;
  if (!opts.skipAlerts) {
    const alertRows = (await checkTripAlerts(userId, tripId)) as { alerts?: unknown[] }[];
    alertCount = alertRows.reduce((n, r) => n + (r.alerts?.length ?? 0), 0);
  }
  const risk = riskFromAlerts(alertCount);

  return {
    tripId: trip.id,
    name: trip.name,
    version: meta[0]?.version ?? 1,
    parentId: meta[0]?.parentId ?? null,
    stops: stops.length,
    parks: parkStops.length,
    driveMiles,
    driveMinutes,
    darkHoursTotal: darkN ? round1(darkTotal) : null,
    darkHoursAvg: darkN ? round1(darkTotal / darkN) : null,
    costTotal: cost.total,
    alertCount,
    riskScore: risk.score,
    riskLabel: risk.label,
  };
}

export interface TripDiff {
  a: TripMetrics;
  b: TripMetrics;
}

/** Side-by-side metrics for two of the caller's trips (drive · dark hours · cost · risk). */
export async function tripDiff(userId: string, aId: string, bId: string): Promise<TripDiff | null> {
  const [a, b] = await Promise.all([tripMetrics(userId, aId), tripMetrics(userId, bId)]);
  if (!a || !b) return null;
  return { a, b };
}

// ---- field brief + offline pack data -------------------------------------------------------------

export interface BriefStop {
  order: number;
  name: string;
  parkCode: string | null;
  designation: string | null;
  lat: number | null;
  lng: number | null;
  entranceFee: number | null;
  directionsUrl: string | null;
  alerts: { category: string; title: string }[];
  visitorCenters: string[];
  campgrounds: { name: string; reservationUrl: string | null }[];
  driveToNext: { miles: number; minutes: number } | null;
  // Hikes attached to this stop (ADR-071) — the "what to do here" the field brief needs at the trailhead.
  hikes: { name: string; lengthMiles: number | null; estTimeHrs: number | null; difficulty: string | null; permitRequired: boolean }[];
  // Lodging for this stop-night (Campgrounds feature) — the STAYS_AT pick (no live availability in a static sheet).
  lodging: { name: string; feeUSD: number | null; reservationUrl: string | null } | null;
}

export interface TripBrief {
  tripId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  stops: BriefStop[];
}

/** Build the field-brief data for a trip: per-stop coordinates, fees, gate/closure notes, VCs, drive. */
export async function tripBrief(userId: string, tripId: string): Promise<TripBrief | null> {
  const trip = await getTrip(userId, tripId);
  if (!trip) return null;
  const stops = (trip.stops ?? []).filter(Boolean) as NonNullable<typeof trip.stops>;
  const out: BriefStop[] = [];
  for (const s of stops) {
    const detail = s.kind === 'park' && s.parkCode ? await parkDetail(s.parkCode) : null;
    out.push({
      order: s.order,
      name: s.parkName ?? s.name ?? s.campgroundName ?? s.poiTitle ?? s.placeTitle ?? 'Stop',
      parkCode: s.parkCode ?? null,
      designation: (detail?.designation as string | null | undefined) ?? null,
      lat: s.lat,
      lng: s.lng,
      entranceFee: detail ? maxFee(detail.entranceFees as { cost?: string }[]) : null,
      directionsUrl: (detail?.directionsUrl as string | null | undefined) ?? null,
      // Closure/Danger alerts double as the "gate notes / road status" the field brief calls for.
      alerts: (detail?.alerts ?? [])
        .filter((a) => a.category === 'Closure' || a.category === 'Danger')
        .map((a) => ({ category: a.category, title: a.title })),
      visitorCenters: (detail?.visitorCenters ?? []).map((v) => v.name),
      campgrounds: (detail?.campgrounds ?? []).map((c) => ({ name: c.name, reservationUrl: c.reservationUrl })),
      driveToNext: s.driveTo ? { miles: Math.round(s.driveTo.miles), minutes: Math.round(s.driveTo.minutes) } : null,
      hikes: (s.hikes ?? []).map((h) => ({
        name: h.name,
        lengthMiles: h.lengthMiles,
        estTimeHrs: h.estTimeHrs,
        difficulty: h.difficulty,
        permitRequired: h.permitRequired,
      })),
      lodging: s.lodging ? { name: s.lodging.name, feeUSD: s.lodging.feeUSD, reservationUrl: s.lodging.reservationUrl } : null,
    });
  }
  return { tripId: trip.id, name: trip.name, startDate: trip.startDate, endDate: trip.endDate, stops: out };
}
