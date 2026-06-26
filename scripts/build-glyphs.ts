import '../lib/load-env';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Vendor the glyph PBFs the basemap needs into `public/basemap/fonts/<fontstack>/<range>.pbf`, so the
 * map serves its label fonts **same-origin** instead of depending on a third-party path.
 *
 * Why this exists (R3 §3.x): `lib/mapStyle.ts` previously hard-coded the glyph URL to
 * `https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf`. That GitHub-Pages asset
 * path has been observed to 404 (every symbol layer silently drops → a map with **no labels**). The fix
 * mirrors the project's self-hosting pattern for the basemap (`scripts/build-basemap.ts`): vendor the PBFs
 * under `public/`, serve them same-origin, and remove the external dependency. The files are tiny
 * (~76KB/range), so unlike `us.pmtiles` they are committed to the repo (not gitignored), which means the
 * default glyph URL works on a fresh checkout, in CI, and in prod with **no build step**.
 *
 * `protomaps-themes-base` (v4.x) renders Latin labels with the `Noto Sans Regular/Medium/Italic` font
 * stacks. We vendor the Latin glyph ranges plus 512-767 (Hawaiian ʻokina U+02BB + spacing modifiers,
 * needed for names like Haleakalā / Puʻuhonua o Hōnaunau). MapLibre requests other ranges (CJK, Cyrillic…)
 * only for labels tagged in those scripts — US/NPS data has none, and a missing range degrades per-glyph
 * (the rest of the label still renders), so we deliberately keep the vendored set small.
 *
 * Usage:
 *   pnpm build:glyphs
 *   # optional overrides:
 *   GLYPHS_SOURCE=https://cdn.jsdelivr.net/gh/protomaps/basemaps-assets@main/fonts \
 *   GLYPHS_STACKS="Noto Sans Regular,Noto Sans Medium,Noto Sans Italic" \
 *   GLYPHS_RANGES="0-255,256-511,512-767" \
 *   GLYPHS_OUT=public/basemap/fonts  pnpm build:glyphs
 *
 * The default source is the jsDelivr mirror of github.com/protomaps/basemaps-assets (reliable for scripted
 * downloads). Point GLYPHS_SOURCE at any `{fontstack}/{range}.pbf` host to re-vendor from elsewhere.
 */
const SOURCE = (process.env.GLYPHS_SOURCE ?? 'https://cdn.jsdelivr.net/gh/protomaps/basemaps-assets@main/fonts').replace(/\/$/, '');
const STACKS = (process.env.GLYPHS_STACKS ?? 'Noto Sans Regular,Noto Sans Medium,Noto Sans Italic')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RANGES = (process.env.GLYPHS_RANGES ?? '0-255,256-511,512-767')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OUT = resolve(process.env.GLYPHS_OUT ?? 'public/basemap/fonts');

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  console.log(
    `Vendoring glyph PBFs…\n  source: ${SOURCE}\n  stacks: ${STACKS.join(', ')}\n  ranges: ${RANGES.join(', ')}\n  out:    ${OUT}\n`,
  );

  let written = 0;
  for (const stack of STACKS) {
    // Files are stored on disk with the literal font-stack name (e.g. "Noto Sans Regular"); the HTTP layer
    // decodes the %20-encoded request path back to that name before the filesystem lookup, so MapLibre's
    // `…/Noto%20Sans%20Regular/0-255.pbf` request resolves to this directory.
    const dir = join(OUT, stack);
    mkdirSync(dir, { recursive: true });
    for (const range of RANGES) {
      const url = `${SOURCE}/${encodeURIComponent(stack)}/${range}.pbf`;
      const res = await fetch(url);
      if (!res.ok) fail(`Failed to fetch ${url} (HTTP ${res.status}). Check GLYPHS_SOURCE / stack / range.`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0) fail(`Empty glyph PBF for ${stack} ${range} from ${url}.`);
      writeFileSync(join(dir, `${range}.pbf`), buf);
      written += 1;
      console.log(`  ✓ ${stack}/${range}.pbf  (${buf.byteLength.toLocaleString()} bytes)`);
    }
  }

  if (!existsSync(OUT)) fail('output directory missing after write.');
  console.log(
    `\n✓ Vendored ${written} glyph PBF(s) under ${OUT}\n` +
      "  These are served same-origin by Next from public/, so lib/mapStyle.ts defaults the glyph URL to\n" +
      "  /basemap/fonts/{fontstack}/{range}.pbf (override with NEXT_PUBLIC_MAP_GLYPHS_URL).\n" +
      '  Commit them (they are small and not gitignored) so labels render everywhere with no build step.\n',
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
