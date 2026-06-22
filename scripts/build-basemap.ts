import '../lib/load-env';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Build a self-hosted Protomaps basemap for the continental US (QA R3 §3.2).
 *
 * Extracts a US-bounded `.pmtiles` from a Protomaps planet build using the `pmtiles` CLI
 * (go-pmtiles) — it pulls only the tiles inside the bbox over HTTP range requests, so the output is a
 * few hundred MB instead of the ~100GB planet. Output lands in `public/basemap/us.pmtiles`, which Next
 * serves same-origin with range support (what the pmtiles protocol needs) for local dev. For
 * production, upload that file to a CDN and point NEXT_PUBLIC_MAP_TILES_URL at the CDN URL.
 *
 * Usage:
 *   PMTILES_SOURCE=https://build.protomaps.com/20260601.pmtiles pnpm build:basemap
 *   # optional overrides:
 *   BASEMAP_BBOX=-125,24,-66.9,49.5  BASEMAP_MAXZOOM=12  BASEMAP_OUT=public/basemap/us.pmtiles
 *
 * Find the latest planet build date at https://build.protomaps.com (a daily `<YYYYMMDD>.pmtiles`).
 * Install the CLI: `brew install pmtiles` or download from github.com/protomaps/go-pmtiles/releases.
 */
const SOURCE = process.env.PMTILES_SOURCE ?? process.argv[2];
const BBOX = process.env.BASEMAP_BBOX ?? '-125,24,-66.9,49.5'; // continental US (matches US_BOUNDS)
const MAXZOOM = process.env.BASEMAP_MAXZOOM ?? '12';
const OUT = resolve(process.env.BASEMAP_OUT ?? 'public/basemap/us.pmtiles');

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// 1) Require the pmtiles CLI (go-pmtiles) — the npm `pmtiles` package is a browser reader, not a CLI.
const probe = spawnSync('pmtiles', ['version'], { encoding: 'utf8' });
if (probe.error) {
  fail(
    'The `pmtiles` CLI is not installed.\n' +
      '  macOS:  brew install pmtiles\n' +
      '  other:  download from https://github.com/protomaps/go-pmtiles/releases\n' +
      'Then re-run: PMTILES_SOURCE=<planet-build-url> pnpm build:basemap',
  );
}

if (!SOURCE) {
  fail(
    'No source planet build given.\n' +
      'Find the latest at https://build.protomaps.com (a daily `<YYYYMMDD>.pmtiles`), then:\n' +
      '  PMTILES_SOURCE=https://build.protomaps.com/<YYYYMMDD>.pmtiles pnpm build:basemap',
  );
}

mkdirSync(dirname(OUT), { recursive: true });

// 2) Extract the US bbox. go-pmtiles streams only the needed tiles via range requests.
console.log(`Extracting US basemap…\n  source:  ${SOURCE}\n  bbox:    ${BBOX}\n  maxzoom: ${MAXZOOM}\n  out:     ${OUT}\n`);
const res = spawnSync(
  'pmtiles',
  ['extract', SOURCE, OUT, `--bbox=${BBOX}`, `--maxzoom=${MAXZOOM}`],
  { stdio: 'inherit' },
);
if (res.status !== 0) fail(`pmtiles extract failed (exit ${res.status ?? 'signal'}).`);
if (!existsSync(OUT)) fail('extract reported success but the output file is missing.');

console.log(
  `\n✓ Wrote ${OUT}\n` +
    '  Dev: set NEXT_PUBLIC_MAP_TILES_URL=/basemap/us.pmtiles (default in .env.example) and restart.\n' +
    '  Prod: upload us.pmtiles to a CDN and set NEXT_PUBLIC_MAP_TILES_URL to that URL.\n',
);
