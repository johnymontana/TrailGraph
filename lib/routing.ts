import { env } from './env';

/**
 * RoutingGateway (ADR-004) — boundary around OpenRouteService.
 *
 * Hybrid policy:
 *  - `greatCircleMiles` (haversine) for cheap proximity/ranking and "within N hours" filtering.
 *  - `driveSegments` (ORS matrix) for committed itinerary `:DRIVE_TO` edges, computed lazily and
 *    cached on the edge by the caller.
 *
 * Swappable to self-hosted OSRM / Mapbox without touching trip logic.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DriveSegment {
  fromIndex: number;
  toIndex: number;
  miles: number;
  minutes: number;
  source: 'ors' | 'great_circle';
}

const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle distance in miles. Used for proximity/ranking, never presented as drive distance. */
export function greatCircleMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** Rough "within N hours" filter helper: great-circle miles ÷ conservative avg speed. */
export function approxDriveMinutes(miles: number, avgMph = 45): number {
  return (miles / avgMph) * 60;
}

export interface GeocodeResult extends LatLng {
  /** Human place label, e.g. "Bozeman, MT, USA". */
  label: string;
}

export interface RoutingGateway {
  /** Real road distance/time between consecutive stops, in order. */
  driveSegments(stops: LatLng[]): Promise<DriveSegment[]>;
  /** Free-text place → coordinates (home-location entry). Null when nothing matches / ORS is down. */
  geocode(text: string): Promise<GeocodeResult | null>;
  /** Coordinates → place label (labels the browser-geolocation capture). Null on failure. */
  reverseGeocode(point: LatLng): Promise<string | null>;
}

class OrsRoutingGateway implements RoutingGateway {
  async driveSegments(stops: LatLng[]): Promise<DriveSegment[]> {
    if (stops.length < 2) return [];

    // ORS matrix expects [lng, lat]; we only need the consecutive diagonal, but the matrix call
    // is one round-trip for the whole trip.
    const locations = stops.map((s) => [s.longitude, s.latitude]);
    let durations: number[][] | undefined;
    let distances: number[][] | undefined;

    try {
      const res = await fetch(`${env.routing.baseUrl}/v2/matrix/driving-car`, {
        method: 'POST',
        headers: {
          Authorization: env.routing.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locations, metrics: ['distance', 'duration'], units: 'mi' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { durations: number[][]; distances: number[][] };
        durations = data.durations;
        distances = data.distances;
      }
    } catch {
      /* fall through to great-circle below */
    }

    const segments: DriveSegment[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      if (durations && distances) {
        segments.push({
          fromIndex: i,
          toIndex: i + 1,
          miles: Math.round(distances[i][i + 1] * 10) / 10,
          minutes: Math.round(durations[i][i + 1] / 60),
          source: 'ors',
        });
      } else {
        // Graceful degradation (§14): if ORS is down, fall back to great-circle, clearly labeled.
        const miles = greatCircleMiles(stops[i], stops[i + 1]);
        segments.push({
          fromIndex: i,
          toIndex: i + 1,
          miles: Math.round(miles * 10) / 10,
          minutes: Math.round(approxDriveMinutes(miles)),
          source: 'great_circle',
        });
      }
    }
    return segments;
  }

  // ORS bundles a Pelias geocoder on the same key (GET, api_key as query param — unlike the POST matrix
  // above, which authorizes via header). US-biased: TrailGraph is a U.S. parks app.
  async geocode(text: string): Promise<GeocodeResult | null> {
    try {
      const url = new URL(`${env.routing.baseUrl}/geocode/search`);
      url.searchParams.set('api_key', env.routing.apiKey);
      url.searchParams.set('text', text);
      url.searchParams.set('boundary.country', 'US');
      url.searchParams.set('size', '1');
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        features?: { geometry: { coordinates: [number, number] }; properties: { label?: string } }[];
      };
      const f = data.features?.[0];
      if (!f) return null;
      const [longitude, latitude] = f.geometry.coordinates;
      return { latitude, longitude, label: f.properties.label ?? text };
    } catch {
      return null;
    }
  }

  async reverseGeocode(point: LatLng): Promise<string | null> {
    try {
      const url = new URL(`${env.routing.baseUrl}/geocode/reverse`);
      url.searchParams.set('api_key', env.routing.apiKey);
      url.searchParams.set('point.lat', String(point.latitude));
      url.searchParams.set('point.lon', String(point.longitude));
      url.searchParams.set('size', '1');
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as { features?: { properties: { label?: string } }[] };
      return data.features?.[0]?.properties.label ?? null;
    } catch {
      return null;
    }
  }
}

export const routing: RoutingGateway = new OrsRoutingGateway();
