import './server-guard'; // reads Blob/fs; keep out of the client bundle
import type { Geometry } from 'geojson';
import { readParkTrails } from './blob-trails';
import type { GpxTrackSeg } from './gpx';
import type { TripHikeRef } from './trips';

/** Flatten a trail geometry (LineString or MultiLineString) into a single ordered coordinate list. */
function coordsOf(geom: Geometry | null | undefined): number[][] {
  if (!geom) return [];
  if (geom.type === 'LineString') return geom.coordinates as number[][];
  if (geom.type === 'MultiLineString') return (geom.coordinates as number[][][]).flat();
  return [];
}

/**
 * Real trail geometry for a trip's hikes as GPX track segments (ADR-067/071). Geometry lives in Blob
 * (`:Park.trailsGeoUrl`), NOT the graph, so we read each park's FeatureCollection ONCE and match each hike
 * by its `properties.id`. Degrades silently (empty list) when a park's geometry isn't synced. The coords
 * are GeoJSON [lon, lat]; GPX wants {lat, lon}.
 */
export async function tripHikeTracks(refs: TripHikeRef[]): Promise<GpxTrackSeg[]> {
  // One FC read per park, not per hike.
  const byPark = new Map<string, { url: string | null; refs: TripHikeRef[] }>();
  for (const r of refs) {
    const pc = r.parkCode ?? r.trailId.split(':')[1] ?? '';
    if (!pc) continue;
    const e = byPark.get(pc) ?? { url: r.geoUrl, refs: [] };
    e.refs.push(r);
    byPark.set(pc, e);
  }

  const tracks: GpxTrackSeg[] = [];
  for (const [parkCode, { url, refs: parkRefs }] of byPark) {
    const fc = await readParkTrails(parkCode, url);
    if (!fc) continue;
    const byId = new Map<string, Geometry | null>();
    for (const f of fc.features) {
      const fid = (f.properties?.id ?? f.id) as string | undefined;
      if (fid) byId.set(fid, f.geometry as Geometry | null);
    }
    for (const r of parkRefs) {
      const pts = coordsOf(byId.get(r.trailId)).map(([lon, lat]) => ({ lat, lon }));
      if (pts.length >= 2) tracks.push({ name: `Hike: ${r.name}`, points: pts });
    }
  }
  return tracks;
}
