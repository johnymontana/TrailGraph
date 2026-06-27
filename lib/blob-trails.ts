import './server-guard'; // BLOB_READ_WRITE_TOKEN + fs; keep out of the client bundle
import type { FeatureCollection } from 'geojson';

/**
 * Per-park trail geometry storage (ADR-067). Simplified GeoJSON FeatureCollections live in Vercel Blob
 * when `BLOB_READ_WRITE_TOKEN` is set, else a local `public/trails/` fallback for dev/CI (so the pipeline
 * works without Blob). Geometry lives HERE — never in Neo4j. `putParkTrails` returns the readable URL,
 * which we stash on `:Park.trailsGeoUrl` so the serve route / offline pack / elevation derive can read it.
 */

const fileName = (parkCode: string) => `${parkCode.toLowerCase()}.geojson`;
const blobPath = (parkCode: string) => `trails/${fileName(parkCode)}`;

export function hasBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Write a park's trail FeatureCollection; returns its readable URL (Blob URL, or `/trails/<code>.geojson`). */
export async function putParkTrails(parkCode: string, fc: FeatureCollection): Promise<string> {
  const body = JSON.stringify(fc);
  if (hasBlob()) {
    const { put } = await import('@vercel/blob');
    const res = await put(blobPath(parkCode), body, {
      access: 'public',
      contentType: 'application/geo+json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return res.url;
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'public', 'trails');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName(parkCode)), body, 'utf8');
  return `/trails/${fileName(parkCode)}`;
}

/** Read a park's trail FeatureCollection back (for the derive step / offline pack). Null on any miss. */
export async function readParkTrails(
  parkCode: string,
  url?: string | null,
): Promise<FeatureCollection | null> {
  try {
    if (url && /^https?:\/\//.test(url)) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as FeatureCollection;
    }
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const txt = await readFile(join(process.cwd(), 'public', 'trails', fileName(parkCode)), 'utf8');
    return JSON.parse(txt) as FeatureCollection;
  } catch {
    return null;
  }
}
