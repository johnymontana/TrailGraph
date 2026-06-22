import '../lib/load-env';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { put } from '@vercel/blob';

/**
 * Upload the self-hosted Protomaps basemap to Vercel Blob (served from Vercel's CDN with HTTP range
 * support, which PMTiles needs). The file is too large for `public/` / a deploy bundle, so it lives in
 * Blob instead. Streamed multipart upload; stable object name so the public URL doesn't churn.
 *
 * Setup: create a Blob store (Vercel dashboard → Storage → Blob) and expose its token —
 *   `vercel env pull .env.local`  (or)  `export BLOB_READ_WRITE_TOKEN=…`
 * Then:
 *   pnpm build:basemap         # writes public/basemap/us.pmtiles
 *   pnpm basemap:upload        # → prints the public URL
 *   # set NEXT_PUBLIC_MAP_TILES_URL to that URL in the Vercel project (Production) and redeploy.
 */
const FILE = resolve(process.env.BASEMAP_OUT ?? 'public/basemap/us.pmtiles');
const NAME = process.env.BASEMAP_BLOB_NAME ?? 'basemap/us.pmtiles';

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error(
      '\n✗ BLOB_READ_WRITE_TOKEN is not set.\n' +
        '  Create a Blob store (Vercel dashboard → Storage → Blob), then either\n' +
        '  `vercel env pull .env.local` or `export BLOB_READ_WRITE_TOKEN=…` and re-run.\n',
    );
    process.exit(1);
  }
  if (!existsSync(FILE)) {
    console.error(`\n✗ ${FILE} not found. Build it first:  pnpm build:basemap\n`);
    process.exit(1);
  }

  const mb = (statSync(FILE).size / 1e6).toFixed(1);
  console.log(`Uploading ${FILE} (${mb} MB) → Vercel Blob as "${NAME}" (multipart)…`);
  const blob = await put(NAME, createReadStream(FILE), {
    access: 'public',
    multipart: true, // streamed, parallel parts + retries — required for a large file
    addRandomSuffix: false, // stable URL so NEXT_PUBLIC_MAP_TILES_URL survives re-uploads
    contentType: 'application/octet-stream',
    token,
  });

  console.log(
    `\n✓ Uploaded: ${blob.url}\n` +
      `  Set NEXT_PUBLIC_MAP_TILES_URL=${blob.url}\n` +
      '  in the Vercel project (Production) env, then redeploy. Re-run this script to refresh tiles.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
