import './server-guard'; // BLOB_READ_WRITE_TOKEN + fs; keep out of the client bundle
import type { FeatureCollection } from 'geojson';

/**
 * Per-campground site/loop geometry storage — the exact mirror of blob-trails.ts. Pitch polygons (OSM
 * `camp_pitch`, Phase 4) / USFS site points live in Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, else
 * a local `public/campsites/` fallback. Geometry lives HERE — never in Neo4j; the readable URL is stashed
 * on `:Campground.sitesGeoUrl`. RIDB-only campgrounds have no per-site geometry, so `sitesGeoUrl` stays
 * null and the detail page falls back to the campsitesForCampground() list.
 */

// Campground ids carry colons ('ridb:232449' / NPS GUIDs) — slugify for a safe path/filename.
const safe = (id: string) => id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const fileName = (id: string) => `${safe(id)}.geojson`;
const blobPath = (id: string) => `campsites/${fileName(id)}`;

export function hasBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Write a campground's site FeatureCollection; returns its readable URL. */
export async function putCampgroundSites(campgroundId: string, fc: FeatureCollection): Promise<string> {
  const body = JSON.stringify(fc);
  if (hasBlob()) {
    const { put } = await import('@vercel/blob');
    const res = await put(blobPath(campgroundId), body, {
      access: 'public',
      contentType: 'application/geo+json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return res.url;
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'public', 'campsites');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName(campgroundId)), body, 'utf8');
  return `/campsites/${fileName(campgroundId)}`;
}

/** Read a campground's site FeatureCollection back (for the detail map). Null on any miss. */
export async function readCampgroundSites(
  campgroundId: string,
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
    const txt = await readFile(join(process.cwd(), 'public', 'campsites', fileName(campgroundId)), 'utf8');
    return JSON.parse(txt) as FeatureCollection;
  } catch {
    return null;
  }
}
