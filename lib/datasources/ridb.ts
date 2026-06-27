import { env } from '../env';

/**
 * RIDB (Recreation Information Database) API v1 client — the backbone for multi-agency campgrounds
 * (NPS · USFS · BLM · USACE · BoR · F&WS). Auth via the `apikey` header; offset pagination, 50/page;
 * `FacilityID` natural keys (== :Campground.ridbId, the federation key parsed from recreation.gov URLs
 * in datasources/recreation.ts). Mirrors lib/nps.ts: polite paging, retry/backoff, and a *pause* error
 * (RidbRateLimitError) so the slow-sync orchestrator can checkpoint + resume rather than fail.
 *
 * RIDB is explicitly free to reuse ("Use Our Data"). We never call it from user traffic (AD-5).
 */

// ─── Wire shapes (RIDB returns PascalCase + a RECDATA/METADATA envelope) ─────────
export interface RidbPage<T> {
  RECDATA: T[];
  METADATA: { RESULTS: { CURRENT_COUNT: number; TOTAL_COUNT: number } };
}

export interface RidbAttribute {
  AttributeName: string;
  AttributeValue: string;
}

export interface RidbFacility {
  FacilityID: string;
  FacilityName: string;
  FacilityTypeDescription: string; // we keep only 'Campground'
  FacilityLatitude?: number;
  FacilityLongitude?: number;
  FacilityReservationURL?: string;
  FacilityPhone?: string;
  Reservable?: boolean;
  Enabled?: boolean;
  LastUpdatedDate?: string; // ISO-ish; used for the nightly delta
  ORGANIZATION?: { OrgID: string; OrgName: string; OrgType?: string }[];
  RECAREA?: { RecAreaID: string; RecAreaName: string }[];
  ATTRIBUTES?: RidbAttribute[];
  FACILITYADDRESS?: { City?: string; AddressStateCode?: string }[];
  GEOJSON?: { TYPE: string; COORDINATES: number[] }; // [lng, lat]
}

export interface RidbCampsite {
  CampsiteID: string;
  FacilityID: string;
  CampsiteName?: string;
  CampsiteType?: string;
  TypeOfUse?: string; // 'Overnight' | 'Day' | 'Management' — keep Overnight
  Loop?: string;
  CampsiteAccessible?: boolean;
  CampsiteReservable?: boolean;
  ATTRIBUTES?: RidbAttribute[];
}

export const RIDB_PAGE_LIMIT = 50;
export const RIDB_CAMPING_ACTIVITY = '9'; // RIDB activity id for Camping (narrows the facilities scan)

/**
 * Thrown when a page can't be fetched because RIDB is rate-limited (429) or 5xx-ing after our retries.
 * The orchestrator treats this as a PAUSE (save progress, resume next window), like NpsRateLimitError.
 */
export class RidbRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RidbRateLimitError';
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** One page fetch with retry/backoff on 429/5xx; persistent failure → RidbRateLimitError (resume later). */
async function fetchRidbPage<T>(
  path: string,
  offset: number,
  params: Record<string, string> = {},
): Promise<{ data: T[]; total: number }> {
  const qs = new URLSearchParams({
    ...params,
    limit: String(RIDB_PAGE_LIMIT),
    offset: String(offset),
  });
  const url = `${env.ridb.baseUrl}/${path}?${qs}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { apikey: env.ridb.apiKey, Accept: 'application/json' } });
    if (res.ok) {
      try {
        const page = (await res.json()) as RidbPage<T>;
        return { data: page.RECDATA ?? [], total: Number(page.METADATA?.RESULTS?.TOTAL_COUNT) || 0 };
      } catch {
        await sleep(500 * 2 ** attempt); // truncated/malformed body — transient, retry like a 5xx
        continue;
      }
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new Error(`RIDB ${path} ${res.status}: ${await res.text()}`);
  }
  throw new RidbRateLimitError(`RIDB ${path} unavailable (429/5xx/parse error) after retries`);
}

/**
 * One offset page of campground Facilities. `lastUpdated` (MM-DD-YYYY) narrows to the nightly delta.
 * RIDB has no server-side "campground only" param, so callers filter on FacilityTypeDescription.
 */
export async function fetchFacilitiesPage(
  offset: number,
  opts: { lastUpdated?: string } = {},
): Promise<{ data: RidbFacility[]; total: number }> {
  const params: Record<string, string> = { full: 'true', activity: RIDB_CAMPING_ACTIVITY };
  if (opts.lastUpdated) params.lastupdated = opts.lastUpdated;
  return fetchRidbPage<RidbFacility>('facilities', offset, params);
}

/** All campsites for one facility (paged internally; small per facility — usually < 200 sites). */
export async function fetchFacilityCampsites(facilityId: string): Promise<RidbCampsite[]> {
  const out: RidbCampsite[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await fetchRidbPage<RidbCampsite>(`facilities/${encodeURIComponent(facilityId)}/campsites`, offset);
    out.push(...page.data);
    total = page.total || out.length;
    if (page.data.length === 0) break;
    offset += RIDB_PAGE_LIMIT;
    await sleep(80); // polite between pages
  }
  return out;
}

// ─── Pure mappers (unit-tested; no I/O) ──────────────────────────────────────────

export type AgencyKind = 'NPS' | 'USFS' | 'BLM' | 'USACE' | 'STATE' | 'PRIVATE';

/** Map a RIDB managing-org name to our coarse agency kind. The full name is preserved separately. */
export function mapAgencyKind(orgName?: string | null): AgencyKind {
  const s = (orgName ?? '').toLowerCase();
  if (s.includes('national park')) return 'NPS';
  if (s.includes('forest service')) return 'USFS';
  if (s.includes('land management')) return 'BLM';
  if (s.includes('army corps') || s.includes('corps of engineers')) return 'USACE';
  if (s.includes('state')) return 'STATE';
  return 'PRIVATE'; // unknown/other (e.g. Bureau of Reclamation, F&WS) — name kept verbatim on :Agency
}

export type CampsiteType = 'tent' | 'rv' | 'group' | 'cabin' | 'walk-in' | 'equestrian';

/** Bucket a RIDB CampsiteType string. Order matters: a "GROUP TENT" site is a group site. */
export function mapCampsiteType(ridbType?: string | null): CampsiteType {
  const s = (ridbType ?? '').toUpperCase();
  if (s.includes('EQUESTRIAN')) return 'equestrian';
  if (s.includes('CABIN')) return 'cabin';
  if (s.includes('GROUP')) return 'group';
  if (s.includes('WALK')) return 'walk-in';
  if (s.includes('TENT')) return 'tent';
  // STANDARD / RV / everything else accommodates an RV → 'rv' (maxRvLengthFt distinguishes capacity).
  return 'rv';
}

/** Pull the first integer out of an attribute value ("30 amp", "30/50 amp" → 30/50; "Yes" → null). */
function firstInt(value: string | undefined): number | null {
  const m = /(\d+)/.exec(value ?? '');
  return m ? Number(m[1]) : null;
}

/** Largest integer in a value ("30/50 amp" → 50). */
function maxInt(value: string | undefined): number | null {
  const nums = [...(value ?? '').matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : null;
}

function truthyAttr(value: string | undefined): boolean {
  const s = (value ?? '').trim().toLowerCase();
  return s !== '' && s !== 'no' && s !== 'n' && s !== 'false' && s !== '0' && s !== 'none';
}

export interface CampsiteAttrs {
  maxRvLengthFt: number | null;
  electricAmps: number | null;
  hasWater: boolean;
  hasSewer: boolean;
  pullThrough: boolean;
}

/** Derive structured site equipment from RIDB campsite ATTRIBUTES (name→value pairs). */
export function campsiteAttrs(attrs?: RidbAttribute[] | null): CampsiteAttrs {
  const byName = new Map<string, string>();
  for (const a of attrs ?? []) byName.set(a.AttributeName.toLowerCase(), a.AttributeValue);

  const electric = byName.get('electricity hookup') ?? byName.get('electric hookup');
  const driveway = byName.get('driveway type') ?? '';
  return {
    maxRvLengthFt: firstInt(byName.get('max vehicle length') ?? byName.get('max rv length')),
    // "30/50 amp" → 50; "Yes"/"30 amp" → that number; absent or "No" → null.
    electricAmps:
      electric && truthyAttr(electric) ? (maxInt(electric) ?? 30) : null,
    hasWater: truthyAttr(byName.get('water hookup')),
    hasSewer: truthyAttr(byName.get('sewer hookup')),
    pullThrough: /pull[\s-]?through/i.test(driveway),
  };
}

/** Facility-level attributes we surface on :Campground (pets, fee, cell). Lossy/sparse — best-effort. */
export function facilityAttrs(attrs?: RidbAttribute[] | null): {
  petsAllowed: boolean | null;
  feeUSD: number | null;
  cellReception: boolean | null;
} {
  const byName = new Map<string, string>();
  for (const a of attrs ?? []) byName.set(a.AttributeName.toLowerCase(), a.AttributeValue);
  const pets = byName.get('pets allowed') ?? byName.get('pets');
  const fee = byName.get('fee description') ?? byName.get('base fee');
  const cell = byName.get('cell phone reception') ?? byName.get('cell reception');
  return {
    petsAllowed: pets == null ? null : truthyAttr(pets),
    feeUSD: fee == null ? null : firstInt(fee),
    cellReception: cell == null ? null : truthyAttr(cell),
  };
}
