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
}

export interface NpsThingToDo {
  id: string;
  title: string;
  shortDescription?: string;
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
  latitude?: string;
  longitude?: string;
  relatedParks?: NpsRelatedPark[];
  accessibility?: Record<string, unknown>;
}

/** Articles (`/articles`) — "learn more" content; `(:Article)-[:ABOUT]->(:Park)`. */
export interface NpsArticle {
  id: string;
  title?: string;
  url?: string;
  listingDescription?: string;
  relatedParks?: NpsRelatedPark[];
  images?: NpsImage[];
}

export interface NpsGeneric {
  id: string;
  [key: string]: unknown;
}

const PAGE_LIMIT = 50;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** One page fetch with retry/backoff on 429/5xx. */
async function fetchPage<T>(
  resource: string,
  start: number,
  params: Record<string, string>,
): Promise<NpsPage<T>> {
  const qs = new URLSearchParams({
    ...params,
    start: String(start),
    limit: String(PAGE_LIMIT),
  });
  const url = `${env.nps.baseUrl}/${resource}?${qs}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'X-Api-Key': env.nps.apiKey } });
    if (res.ok) return (await res.json()) as NpsPage<T>;
    if (res.status === 429 || res.status >= 500) {
      await sleep(500 * 2 ** attempt); // exponential backoff
      continue;
    }
    throw new Error(`NPS ${resource} ${res.status}: ${await res.text()}`);
  }
  throw new Error(`NPS ${resource} failed after retries`);
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
    start += PAGE_LIMIT;
    if (page.data.length === 0) break; // safety
    await sleep(120); // be polite between pages
  }
  return out;
}
