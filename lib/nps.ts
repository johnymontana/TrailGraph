import { env } from './env';

/**
 * NPS Data API v1 client (§9). Auth via X-Api-Key header; zero-based `start` pagination, 50/page;
 * GUID natural keys. We paginate politely and never call NPS from user traffic (AD-5).
 */

export interface NpsPage<T> {
  total: string; // NPS returns counts as strings
  limit: string;
  start: string;
  data: T[];
}

export interface NpsActivityRef {
  id: string;
  name: string;
}
export interface NpsImage {
  url: string;
  altText?: string;
  caption?: string;
  title?: string;
  credit?: string;
}

export interface NpsPark {
  id: string;
  parkCode: string;
  name: string;
  fullName: string;
  description: string;
  designation: string;
  states: string; // CSV, e.g. "WY,MT,ID"
  latitude: string;
  longitude: string;
  url: string;
  directionsUrl?: string;
  directionsInfo?: string;
  weatherInfo?: string;
  activities: NpsActivityRef[];
  topics: NpsActivityRef[];
  entranceFees?: { cost: string; description: string; title: string }[];
  entrancePasses?: { cost: string; description: string; title: string }[];
  operatingHours?: unknown[];
  contacts?: unknown;
  addresses?: unknown[];
  images?: NpsImage[];
}

export interface NpsAlert {
  id: string;
  url?: string;
  title: string;
  parkCode: string;
  description: string;
  category: string; // Danger | Closure | Caution | Information
  lastIndexedDate?: string;
}

export interface NpsCampground {
  id: string;
  name: string;
  parkCode: string;
  description?: string;
  latitude?: string;
  longitude?: string;
  reservationUrl?: string;
  amenities?: Record<string, unknown>;
  accessibility?: Record<string, unknown>;
  operatingHours?: unknown[]; // requested via fields= (F1)
  campsites?: Record<string, unknown>; // F3: site-type counts (tentOnly, electricalHookups, rvOnly, group, totalSites…)
  numberOfSitesReservable?: string | number; // F3
  numberOfSitesFirstComeFirstServe?: string | number; // F3
  fees?: unknown[]; // F3
}

export interface NpsThingToDo {
  id: string;
  title: string;
  shortDescription?: string;
  longDescription?: string; // requested via fields= (F7) — richer text for length/elevation extraction
  duration?: string;
  durationDescription?: string;
  timeOfDay?: string[];
  season?: string[];
  topics?: NpsActivityRef[];
  tags?: string[];
  arePetsPermitted?: string | boolean;
  isReservationRequired?: string | boolean;
  doFeesApply?: string | boolean;
  accessibilityInformation?: string; // F5
  latitude?: string;
  longitude?: string;
  relatedParks?: { parkCode: string }[];
  activities?: NpsActivityRef[];
}

export interface NpsRelatedPark {
  parkCode: string;
  states?: string;
  fullName?: string;
}

/** POIs (`/places`) — first-class nodes linking parks ↔ amenities ↔ tags ↔ stamps ↔ audio. */
export interface NpsPlace {
  id: string;
  title: string;
  listingDescription?: string;
  bodyText?: string;
  latitude?: string;
  longitude?: string;
  relatedParks?: NpsRelatedPark[];
  amenities?: (string | NpsActivityRef)[];
  tags?: string[];
  images?: NpsImage[];
  audioDescription?: string;
  isPassportStampLocation?: string | boolean;
}

/** Historical figures (`/people`) — span multiple parks → thematic multi-park trails. */
export interface NpsPerson {
  id: string;
  title: string;
  firstName?: string;
  lastName?: string;
  listingDescription?: string;
  bodyText?: string;
  latitude?: string;
  longitude?: string;
  relatedParks?: NpsRelatedPark[];
  tags?: string[];
  images?: NpsImage[];
}

/** Ordered tours (`/tours`) — stops reference places/campgrounds/visitor-centers (a graph path). */
export interface NpsTourStop {
  id?: string;
  ordinal?: string | number;
  assetType?: string; // Place | Campground | VisitorCenter
  assetId?: string;
  title?: string;
  audioFileUrl?: string; // F6: self-guided audio
  transcript?: string;
}
export interface NpsTour {
  id: string;
  title: string;
  description?: string;
  durationMin?: string;
  durationMax?: string;
  relatedParks?: NpsRelatedPark[];
  activities?: NpsActivityRef[];
  topics?: NpsActivityRef[];
  stops?: NpsTourStop[];
}

/** Passport stamp locations (`/passportstamplocations`) — collection/gamification graph. */
export interface NpsPassportStamp {
  id: string;
  label?: string;
  type?: string;
  parks?: NpsRelatedPark[];
}

/** Parking lots (`/parkinglots`) — arrival/logistics + accessibility. */
export interface NpsParkingLot {
  id: string;
  name?: string;
  description?: string;
  latitude?: string;
  longitude?: string;
  relatedParks?: NpsRelatedPark[];
  accessibility?: Record<string, unknown>;
  operatingHours?: unknown[]; // F1/F10 (requested via fields=)
  livedata?: Record<string, unknown>; // F10: real-time availability (sparse); kept runtime, not stored
}

/** Articles (`/articles`) — "learn more" content; `(:Article)-[:ABOUT]->(:Park)`. */
export interface NpsArticle {
  id: string;
  title?: string;
  url?: string;
  listingDescription?: string;
  bodyText?: string; // full article body — must be requested via fields=; activates article_fulltext (F8)
  relatedParks?: NpsRelatedPark[];
  images?: NpsImage[];
}

/** Lesson plans (`/lessonplans`) — educator content powering "Ranger School"; `(:LessonPlan)-[:ABOUT]->(:Park)`. */
export interface NpsLessonPlan {
  id: string;
  title?: string;
  url?: string;
  gradeLevel?: string; // e.g. "Sixth Grade-Eighth Grade"
  subject?: string;
  duration?: string;
  durationInMinutes?: number | string;
  questionObjective?: string; // the lesson's essential question
  objective?: string;
  commonCore?: string; // standards alignment (narrative)
  image?: NpsImage;
  images?: NpsImage[];
  relatedParks?: NpsRelatedPark[];
  topics?: NpsActivityRef[];
}

/** Multimedia (`/multimedia/audio|galleries|videos`, F6) — one shape covers the three (extra fields ignored). */
export interface NpsMultimedia {
  id: string;
  title?: string;
  description?: string;
  durationMs?: number | string;
  permalinkUrl?: string;
  transcript?: string;
  assetCount?: number | string;
  relatedParks?: NpsRelatedPark[];
  tags?: string[];
}

/** News releases (`/newsreleases`, F8) — timely content; `(:NewsRelease)-[:ABOUT]->(:Park)`. */
export interface NpsNewsRelease {
  id: string;
  url?: string;
  title?: string;
  abstract?: string;
  releasedate?: string; // e.g. "2026-06-20 00:00:00.0"
  image?: NpsImage;
  images?: NpsImage[];
  relatedParks?: NpsRelatedPark[];
  tags?: string[];
}

export interface NpsGeneric {
  id: string;
  [key: string]: unknown;
}

export const NPS_PAGE_LIMIT = 50;

/**
 * Thrown when a page can't be fetched because the NPS key is rate-limited (429) or NPS is 5xx-ing
 * after our retries are exhausted. The sync orchestrator treats this as a *pause* (save progress,
 * resume next window), NOT a failure — distinct from a real error (bad request, parse failure).
 */
export class NpsRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NpsRateLimitError';
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * One page fetch with retry/backoff on 429/5xx. Exhausting the retries throws `NpsRateLimitError`
 * (transient/quota) so callers can resume later; a 4xx other than 429 throws a plain Error (real bug).
 * Exported so the orchestrator can page-and-checkpoint large resources (e.g. /places, 17k+ records).
 */
export async function fetchPage<T>(
  resource: string,
  start: number,
  params: Record<string, string>,
): Promise<NpsPage<T>> {
  const qs = new URLSearchParams({
    ...params,
    start: String(start),
    limit: String(NPS_PAGE_LIMIT),
  });
  const url = `${env.nps.baseUrl}/${resource}?${qs}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'X-Api-Key': env.nps.apiKey } });
    if (res.ok) {
      // A truncated/malformed body (seen on large /multimedia pages — the server cuts the response
      // mid-string) makes res.json() throw. That's almost always transient, so retry like a 5xx rather
      // than letting one bad page abort the whole resource. The final NpsRateLimitError below makes a
      // *persistently* bad page PAUSE the resource (resume next run) instead of hard-failing the sync.
      try {
        return (await res.json()) as NpsPage<T>;
      } catch {
        await sleep(500 * 2 ** attempt);
        continue;
      }
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * 2 ** attempt); // exponential backoff
      continue;
    }
    throw new Error(`NPS ${resource} ${res.status}: ${await res.text()}`);
  }
  throw new NpsRateLimitError(`NPS ${resource} unavailable (429/5xx/parse error) after retries`);
}

/**
 * Fetch ALL records for a resource, paginating until exhausted. Optionally request extra `fields`
 * (some data, e.g. images, must be requested explicitly, §9.1).
 */
export async function fetchAll<T = NpsGeneric>(
  resource: string,
  opts: { fields?: string[]; params?: Record<string, string> } = {},
): Promise<T[]> {
  const params: Record<string, string> = { ...(opts.params ?? {}) };
  if (opts.fields?.length) params.fields = opts.fields.join(',');

  const out: T[] = [];
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const page = await fetchPage<T>(resource, start, params);
    out.push(...page.data);
    total = Number(page.total) || out.length;
    start += NPS_PAGE_LIMIT;
    if (page.data.length === 0) break; // safety
    await sleep(120); // be polite between pages
  }
  return out;
}
