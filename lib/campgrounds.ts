import { readGraph } from './neo4j';
import { env } from './env';
import { recreationUrl } from './datasources/recreation';
import { getCampgroundAvailability, enumerateNights, countOpenNights } from './datasources/campAvailability';

/**
 * Multi-agency campground read queries (Campgrounds feature). Mirrors lib/queries.ts conventions: a
 * `where:string[]` predicate builder + `EXISTS {}` subqueries, a shared summary RETURN, paged items +
 * an accurate `count` query, per-relationship `CALL {}` subqueries in detail (no cartesian products),
 * `toInteger()` for SKIP/LIMIT. Kept in its own module so lib/queries.ts stays lean.
 *
 * Availability is NEVER read here — it's a runtime concern (lib/datasources/campAvailability.ts), always
 * nullable, and degrades to a recreation.gov deep link.
 */

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface CampgroundSummary {
  id: string;
  name: string;
  source: string;
  agency: string | null;
  ridbId: string | null;
  reservable: boolean;
  fcfs: boolean;
  dispersed: boolean;
  totalSites: number | null;
  sitesReservable: number | null;
  sitesFirstCome: number | null;
  hasHookups: boolean;
  maxAmps: number | null;
  ada: boolean;
  petsAllowed: boolean;
  dumpStation: boolean;
  showers: boolean;
  drinkingWater: boolean;
  cellReception: boolean;
  darkSky: boolean;
  feeUSD: number | null;
  free: boolean;
  rvMaxLengthFt: number | null;
  reservationUrl: string | null;
  lat: number | null;
  lng: number | null;
  dataConfidence: string | null;
  sitesGeoUrl: string | null;
  // Booking intelligence (null until the DERIVE_BOOKING_DIFFICULTY step runs).
  weekendFillRate: number | null;
  booksOutDays: number | null;
  parkName: string | null;
  parkCode: string | null;
  recAreaName: string | null;
  distanceMiles: number | null; // populated only when nearParkCode is given
}

// `maxAmps` reduces over the campground's electric campsites (0 → none, mapped to null below).
const CAMPGROUND_SUMMARY_RETURN = `
  c.id AS id, c.name AS name, coalesce(c.source, 'nps') AS source, c.agency AS agency, c.ridbId AS ridbId,
  coalesce(c.reservable, (c.sitesReservable > 0), false) AS reservable,
  coalesce(c.fcfs, (c.sitesFirstCome > 0), false) AS fcfs,
  coalesce(c.dispersed, false) AS dispersed,
  c.totalSites AS totalSites, c.sitesReservable AS sitesReservable, c.sitesFirstCome AS sitesFirstCome,
  coalesce(c.hasHookups, false) AS hasHookups,
  reduce(m = 0, a IN [ (c)-[:HAS_SITE]->(s:Campsite) WHERE s.electricAmps IS NOT NULL | s.electricAmps ]
         | CASE WHEN a > m THEN a ELSE m END) AS maxAmps,
  (coalesce(c.wheelchairAccessible, false) OR EXISTS { (c)-[:HAS_SITE]->(sa:Campsite) WHERE sa.ada = true }) AS ada,
  coalesce(c.petsAllowed, false) AS petsAllowed,
  coalesce(c.hasDumpStation, false) AS dumpStation, coalesce(c.hasShowers, false) AS showers,
  coalesce(c.hasPotableWater, false) AS drinkingWater, coalesce(c.cellReception, false) AS cellReception,
  EXISTS { (c)-[:IN_PARK|NEAR]->(pk:Park) WHERE coalesce(pk.darkSkyCertified, false) OR coalesce(pk.bortleScale, 99) <= 3 } AS darkSky,
  c.feeUSD AS feeUSD, (coalesce(c.feeUSD, -1) = 0) AS free,
  c.rvMaxLengthFt AS rvMaxLengthFt, c.reservationUrl AS reservationUrl,
  c.location.latitude AS lat, c.location.longitude AS lng, c.dataConfidence AS dataConfidence,
  c.sitesGeoUrl AS sitesGeoUrl, c.weekendFillRate AS weekendFillRate, c.booksOutDays AS booksOutDays,
  head([ (c)-[:IN_PARK]->(p:Park) | p.fullName ]) AS parkName,
  head([ (c)-[:IN_PARK]->(p2:Park) | p2.parkCode ]) AS parkCode,
  head([ (c)-[:IN_RECAREA]->(ra:RecArea) | ra.name ]) AS recAreaName,
  CASE WHEN $nearParkCode IS NULL THEN null
       ELSE head([ (c)-[:IN_PARK]->(:Park {parkCode: $nearParkCode}) | 0.0 ]
                 + [ (c)-[rn:NEAR]->(:Park {parkCode: $nearParkCode}) | rn.miles ]) END AS distanceMiles
`;

function toFulltextQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}*`)
    .join(' ');
}

/** maxAmps comes back as 0 when a campground has no electric site; surface that as null. */
function normalizeSummary(r: CampgroundSummary): CampgroundSummary {
  return { ...r, maxAmps: r.maxAmps && r.maxAmps > 0 ? r.maxAmps : null };
}

/** Faceted + full-text campground finder — the multi-agency analogue of searchParks/searchTrails. */
export async function searchCampgrounds(opts: {
  q?: string;
  agency?: string;
  reservable?: boolean;
  fcfs?: boolean;
  dispersed?: boolean;
  free?: boolean;
  siteType?: string;
  hookups?: boolean;
  minAmps?: number;
  maxRvLength?: number;
  ada?: boolean;
  pets?: boolean;
  dumpStation?: boolean;
  showers?: boolean;
  drinkingWater?: boolean;
  cellReception?: boolean;
  darkSky?: boolean;
  maxPriceUSD?: number;
  elevationMin?: number;
  elevationMax?: number;
  nearParkCode?: string;
  nearTrailId?: string;
  hasRidb?: boolean; // availability candidate set: only campgrounds with a RIDB facility id
  bbox?: BBox;
  limit?: number;
  offset?: number;
}): Promise<{ items: CampgroundSummary[]; total: number }> {
  const o = opts;
  const limit = o.limit ?? 24;
  const offset = o.offset ?? 0;
  const where: string[] = [];
  if (o.agency) where.push('c.agency = $agency');
  if (o.reservable) where.push('coalesce(c.reservable, (c.sitesReservable > 0), false) = true');
  if (o.fcfs) where.push('coalesce(c.fcfs, (c.sitesFirstCome > 0), false) = true');
  if (o.dispersed) where.push('coalesce(c.dispersed, false) = true');
  if (o.free) where.push('coalesce(c.feeUSD, -1) = 0');
  if (o.siteType) where.push('EXISTS { (c)-[:HAS_SITE]->(s:Campsite) WHERE s.type = $siteType }');
  if (o.hookups) where.push('coalesce(c.hasHookups, false) = true');
  if (o.minAmps != null) where.push('EXISTS { (c)-[:HAS_SITE]->(s:Campsite) WHERE coalesce(s.electricAmps, 0) >= $minAmps }');
  if (o.maxRvLength != null)
    where.push(
      '(coalesce(c.rvMaxLengthFt, 0) >= $maxRvLength OR EXISTS { (c)-[:HAS_SITE]->(s:Campsite) WHERE coalesce(s.maxRvLengthFt, 0) >= $maxRvLength })',
    );
  if (o.ada) where.push('(coalesce(c.wheelchairAccessible, false) = true OR EXISTS { (c)-[:HAS_SITE]->(s:Campsite) WHERE s.ada = true })');
  if (o.pets) where.push('coalesce(c.petsAllowed, false) = true');
  if (o.dumpStation) where.push('coalesce(c.hasDumpStation, false) = true');
  if (o.showers) where.push('coalesce(c.hasShowers, false) = true');
  if (o.drinkingWater) where.push('coalesce(c.hasPotableWater, false) = true');
  if (o.cellReception) where.push('coalesce(c.cellReception, false) = true');
  if (o.darkSky) where.push('EXISTS { (c)-[:IN_PARK|NEAR]->(p:Park) WHERE coalesce(p.darkSkyCertified, false) OR coalesce(p.bortleScale, 99) <= 3 }');
  if (o.maxPriceUSD != null) where.push('c.feeUSD <= $maxPriceUSD');
  if (o.elevationMin != null) where.push('coalesce(c.elevationFt, 999999) >= $elevationMin');
  if (o.elevationMax != null) where.push('coalesce(c.elevationFt, -1) <= $elevationMax');
  if (o.nearParkCode)
    where.push('(EXISTS { (c)-[:IN_PARK]->(:Park {parkCode: $nearParkCode}) } OR EXISTS { (c)-[:NEAR]->(:Park {parkCode: $nearParkCode}) })');
  if (o.nearTrailId) where.push('EXISTS { (c)-[:NEAR_TRAILHEAD]->(:Trail {id: $nearTrailId}) }');
  if (o.hasRidb) where.push('c.ridbId IS NOT NULL');
  if (o.bbox)
    where.push(
      'c.location.longitude >= $west AND c.location.longitude <= $east AND c.location.latitude >= $south AND c.location.latitude <= $north',
    );
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const ftq = o.q ? toFulltextQuery(o.q) : '';
  const source = ftq
    ? `CALL db.index.fulltext.queryNodes('campground_fulltext', $q) YIELD node AS c, score ${whereClause}`
    : `MATCH (c:Campground) ${whereClause} WITH c, 0.0 AS score`;
  const order = ftq
    ? 'ORDER BY score DESC, c.name ASC'
    : o.nearParkCode
      ? 'ORDER BY distanceMiles ASC, c.name ASC'
      : 'ORDER BY c.name ASC';

  const params = {
    q: ftq || null,
    agency: o.agency ?? null,
    siteType: o.siteType ?? null,
    minAmps: o.minAmps ?? null,
    maxRvLength: o.maxRvLength ?? null,
    maxPriceUSD: o.maxPriceUSD ?? null,
    elevationMin: o.elevationMin ?? null,
    elevationMax: o.elevationMax ?? null,
    nearParkCode: o.nearParkCode ?? null,
    nearTrailId: o.nearTrailId ?? null,
    west: o.bbox?.minLng ?? null,
    east: o.bbox?.maxLng ?? null,
    south: o.bbox?.minLat ?? null,
    north: o.bbox?.maxLat ?? null,
    limit,
    offset,
  };

  const items = await readGraph<CampgroundSummary>(
    `${source} RETURN ${CAMPGROUND_SUMMARY_RETURN}, score ${order} SKIP toInteger($offset) LIMIT toInteger($limit)`,
    params,
  );
  const totalRows = await readGraph<{ total: number }>(`${source} RETURN count(c) AS total`, params);
  return { items: items.map(normalizeSummary), total: totalRows[0]?.total ?? items.length };
}

export interface CampsiteRow {
  id: string;
  loop: string | null;
  number: string | null;
  type: string | null;
  maxRvLengthFt: number | null;
  electricAmps: number | null;
  hasWater: boolean;
  hasSewer: boolean;
  pullThrough: boolean;
  ada: boolean;
  reservable: boolean;
  maxPeople: number | null; // occupancy — null when unreported, NEVER coalesced to 0
  campfireAllowed: boolean | null; // null = not reported (distinct from an explicit no)
  shade: boolean;
}

export interface CampgroundDetail extends CampgroundSummary {
  description: string | null;
  adaInfo: string | null;
  seasonOpen: string | null;
  seasonClose: string | null;
  bearBoxRequired: boolean | null;
  sourceIds: Record<string, unknown> | null;
  agencyName: string | null;
  agencyKind: string | null;
  sites: CampsiteRow[];
  amenities: { id: string; name: string }[];
  nearParks: { parkCode: string; name: string; miles: number }[];
  nearTrails: { id: string; name: string; miles: number }[];
}

/** Full campground detail: metadata + sites + amenities + agency + NEAR park/trailhead + booking stats. */
export async function campgroundDetail(id: string): Promise<CampgroundDetail | null> {
  const rows = await readGraph<CampgroundDetail & { sourceIdsRaw: string | null }>(
    `MATCH (c:Campground {id: $id})
     CALL { WITH c OPTIONAL MATCH (c)-[:HAS_SITE]->(s:Campsite)
            RETURN collect(DISTINCT s{.id, .loop, .number, .type, .maxRvLengthFt, .electricAmps, .maxPeople,
                   .campfireAllowed, hasWater: coalesce(s.hasWater, false), hasSewer: coalesce(s.hasSewer, false),
                   pullThrough: coalesce(s.pullThrough, false), ada: coalesce(s.ada, false),
                   reservable: coalesce(s.reservable, false), shade: coalesce(s.shade, false)})[..600] AS sites }
     CALL { WITH c OPTIONAL MATCH (c)-[:HAS_AMENITY]->(a:Amenity)
            RETURN collect(DISTINCT a{.id, .name}) AS amenities }
     CALL { WITH c OPTIONAL MATCH (c)-[:MANAGED_BY]->(ag:Agency)
            RETURN head(collect(ag{.name, .kind})) AS agency }
     CALL { WITH c OPTIONAL MATCH (c)-[:IN_RECAREA]->(ra:RecArea)
            RETURN head(collect(ra{.name})) AS recArea }
     CALL { WITH c OPTIONAL MATCH (c)-[r:NEAR]->(p:Park)
            RETURN [x IN collect({parkCode: p.parkCode, name: p.fullName, miles: r.miles}) WHERE x.parkCode IS NOT NULL] AS nearParks }
     CALL { WITH c OPTIONAL MATCH (c)-[r:NEAR_TRAILHEAD]->(t:Trail)
            RETURN [x IN collect({id: t.id, name: t.name, miles: r.miles}) WHERE x.id IS NOT NULL][..8] AS nearTrails }
     RETURN ${CAMPGROUND_SUMMARY_RETURN},
            c.description AS description, c.adaInfo AS adaInfo, c.seasonOpen AS seasonOpen,
            c.seasonClose AS seasonClose, c.bearBoxRequired AS bearBoxRequired, c.sourceIds AS sourceIdsRaw,
            agency.name AS agencyName, agency.kind AS agencyKind,
            sites, amenities, nearParks, nearTrails`,
    { id, nearParkCode: null },
  );
  const r = rows[0];
  if (!r) return null;
  let sourceIds: Record<string, unknown> | null = null;
  try {
    sourceIds = r.sourceIdsRaw ? (JSON.parse(r.sourceIdsRaw) as Record<string, unknown>) : null;
  } catch {
    sourceIds = null;
  }
  return {
    ...r, // carries description/adaInfo/season*/bearBoxRequired/agencyName/agencyKind + all summary fields
    maxAmps: r.maxAmps && r.maxAmps > 0 ? r.maxAmps : null,
    sourceIds,
    sites: r.sites ?? [],
    amenities: r.amenities ?? [],
    nearParks: r.nearParks ?? [],
    nearTrails: r.nearTrails ?? [],
  };
}

/** The site list when a campground has no Blob loop geometry (RIDB-only) — drives the detail sites table. */
export async function campsitesForCampground(id: string): Promise<CampsiteRow[]> {
  return readGraph<CampsiteRow>(
    `MATCH (c:Campground {id: $id})-[:HAS_SITE]->(s:Campsite)
     RETURN s.id AS id, s.loop AS loop, s.number AS number, s.type AS type,
            s.maxRvLengthFt AS maxRvLengthFt, s.electricAmps AS electricAmps,
            coalesce(s.hasWater, false) AS hasWater, coalesce(s.hasSewer, false) AS hasSewer,
            coalesce(s.pullThrough, false) AS pullThrough, coalesce(s.ada, false) AS ada,
            coalesce(s.reservable, false) AS reservable,
            s.maxPeople AS maxPeople, s.campfireAllowed AS campfireAllowed, coalesce(s.shade, false) AS shade
     ORDER BY s.loop, s.number`,
    { id },
  );
}

/** Filter-dropdown options for the campground finder (mirrors trailFacets). */
export async function campgroundFacets(): Promise<{
  agencies: string[];
  siteTypes: string[];
  parks: { parkCode: string; name: string }[];
  recAreas: { id: string; name: string }[];
  maxFeeUSD: number | null;
  maxRvLengthFt: number | null;
}> {
  const rows = await readGraph<{
    agencies: (string | null)[];
    siteTypes: (string | null)[];
    parks: { parkCode: string; name: string }[];
    recAreas: { id: string; name: string }[];
    maxFee: number | null;
    maxRv: number | null;
  }>(
    `MATCH (c:Campground)
     OPTIONAL MATCH (c)-[:HAS_SITE]->(s:Campsite)
     OPTIONAL MATCH (c)-[:IN_PARK]->(p:Park)
     OPTIONAL MATCH (c)-[:IN_RECAREA]->(ra:RecArea)
     RETURN collect(DISTINCT c.agency) AS agencies, collect(DISTINCT s.type) AS siteTypes,
            collect(DISTINCT CASE WHEN p IS NULL THEN null ELSE {parkCode: p.parkCode, name: p.fullName} END) AS parks,
            collect(DISTINCT CASE WHEN ra IS NULL THEN null ELSE {id: ra.id, name: ra.name} END) AS recAreas,
            max(c.feeUSD) AS maxFee, max(c.rvMaxLengthFt) AS maxRv`,
  );
  const r = rows[0] ?? { agencies: [], siteTypes: [], parks: [], recAreas: [], maxFee: null, maxRv: null };
  return {
    agencies: r.agencies.filter((a): a is string => !!a).sort(),
    siteTypes: r.siteTypes.filter((s): s is string => !!s).sort(),
    parks: r.parks.filter((p) => p && p.parkCode).sort((a, b) => a.name.localeCompare(b.name)),
    recAreas: r.recAreas.filter((ra) => ra && ra.id).sort((a, b) => a.name.localeCompare(b.name)),
    maxFeeUSD: r.maxFee ?? null,
    maxRvLengthFt: r.maxRv ?? null,
  };
}

// ── Live availability (Phase 2; gated by CAMP_AVAILABILITY_ENABLED, always degrades to a deep link) ──

const AVAIL_POLL_CAP = 12; // never poll more than this per request (cost + ToS discipline)

/** The recreation.gov deep link a campground always degrades to. */
export function bookingUrlFor(c: { reservationUrl: string | null; ridbId: string | null }): string | null {
  return c.reservationUrl ?? (c.ridbId ? recreationUrl(c.ridbId) : null);
}

/**
 * The date the rolling reservation window opens for a given arrival: arrivalDate − windowMonths. Pure
 * (unit-tested). recreation.gov is typically a 6-month rolling window. Returns the ISO date + whether it's
 * already in the past (window already open) and days-until-open from `today`.
 */
export function bookingWindowOpenDate(
  arrivalDate: string,
  windowMonths: number,
  today: string,
): { windowOpensOn: string; opensInPast: boolean; daysUntilOpen: number } {
  const arrival = new Date(`${arrivalDate}T00:00:00Z`);
  const open = new Date(arrival);
  open.setUTCMonth(open.getUTCMonth() - Math.max(0, Math.round(windowMonths)));
  const windowOpensOn = open.toISOString().slice(0, 10);
  const t = Date.parse(`${today}T00:00:00Z`);
  const daysUntilOpen = Math.ceil((open.getTime() - t) / 86_400_000);
  return { windowOpensOn, opensInPast: daysUntilOpen <= 0, daysUntilOpen };
}

export interface AvailabilityChipData {
  sitesOpen: number | null;
  total: number | null;
  state: 'ok' | 'unavailable';
}

/**
 * Per-campground availability chips for the finder (a small candidate set, already graph-filtered). For
 * each item with a ridbId, poll the months covering [from,to] and report distinct sites with ≥1 open
 * night. Flag off / unreachable → `state:'unavailable'` (the card degrades to "Check on recreation.gov ↗").
 */
export async function campAvailabilityForList(
  items: { id: string; ridbId: string | null; totalSites: number | null }[],
  range: { from: string; to: string },
): Promise<Record<string, AvailabilityChipData>> {
  const out: Record<string, AvailabilityChipData> = {};
  const nights = enumerateNights(range.from, range.to);
  if (!nights.length) return out;
  const months = [...new Set(nights.map((d) => d.slice(0, 7)))];
  const targets = items.filter((i) => i.ridbId).slice(0, AVAIL_POLL_CAP);
  for (const it of targets) {
    const monthData = await Promise.all(months.map((m) => getCampgroundAvailability(it.ridbId!, `${m}-01`)));
    if (monthData.every((m) => m === null)) {
      out[it.id] = { sitesOpen: null, total: it.totalSites, state: 'unavailable' };
      continue;
    }
    const { sampleSiteCount } = countOpenNights(monthData, nights);
    out[it.id] = { sitesOpen: sampleSiteCount, total: it.totalSites, state: 'ok' };
  }
  return out;
}

export interface AvailabilityResult {
  campground: CampgroundSummary;
  nightsOpen: number;
  sampleSiteCount: number;
  bookingUrl: string | null;
}

/**
 * "Find me anything open" — graph-filter to a small candidate set FIRST (cheap), then poll only that set.
 * Ranks by open-nights then distance. When the flag is off, returns the candidates as `degraded` deep links.
 */
export async function searchAvailability(opts: {
  parkCode?: string;
  startDate: string;
  endDate: string;
  minNights?: number;
  siteType?: string;
  hookups?: boolean;
  ada?: boolean;
  limit?: number;
}): Promise<{ degraded: boolean; results: AvailabilityResult[] }> {
  const { items } = await searchCampgrounds({
    nearParkCode: opts.parkCode,
    siteType: opts.siteType && opts.siteType !== 'any' ? opts.siteType : undefined,
    hookups: opts.hookups,
    ada: opts.ada,
    hasRidb: true,
    limit: AVAIL_POLL_CAP,
  });
  const nights = enumerateNights(opts.startDate, opts.endDate);
  if (!env.camp.availabilityEnabled || !nights.length) {
    return {
      degraded: true,
      results: items.map((c) => ({ campground: c, nightsOpen: 0, sampleSiteCount: 0, bookingUrl: bookingUrlFor(c) })),
    };
  }
  const months = [...new Set(nights.map((d) => d.slice(0, 7)))];
  const ranked: AvailabilityResult[] = [];
  for (const c of items) {
    if (!c.ridbId) continue;
    const monthData = await Promise.all(months.map((m) => getCampgroundAvailability(c.ridbId!, `${m}-01`)));
    const open = countOpenNights(monthData, nights, { siteType: opts.siteType, minNights: opts.minNights });
    if (open.nightsOpen > 0) {
      ranked.push({ campground: c, nightsOpen: open.nightsOpen, sampleSiteCount: open.sampleSiteCount, bookingUrl: bookingUrlFor(c) });
    }
  }
  ranked.sort((a, b) => b.nightsOpen - a.nightsOpen || (a.campground.distanceMiles ?? 1e9) - (b.campground.distanceMiles ?? 1e9));
  return { degraded: false, results: ranked.slice(0, opts.limit ?? 8) };
}
