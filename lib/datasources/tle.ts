/**
 * Two-Line Element (TLE) source for satellite-pass prediction (Astro Command Center, ADR-055). Behind the
 * AD-3 adapter pattern: fetched on-demand from CelesTrak's "visual" group (the naked-eye-bright sats,
 * incl. the ISS) and cached ~12h via Next's fetch revalidate — NOT graph-synced (orbital elements decay
 * daily, like webcams/roadevents in `conditions.ts`). Honesty (ADR-043): a live-fetch failure yields `[]`
 * ("passes unavailable") rather than propagating a stale TLE, which would fabricate wrong passes.
 */
export interface Tle {
  name: string;
  line1: string;
  line2: string;
}

const CELESTRAK_VISUAL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle';

/** Parse CelesTrak 3-line TLE text into records. Tolerant of CRLF + blank lines. Pure (unit-tested). */
export function parseTle(text: string): Tle[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    // A record is: name line, "1 ..." line, "2 ..." line.
    if (lines[i] && lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] });
      i += 2;
    }
  }
  return out;
}

/** Live bright-satellite TLEs (ISS + visual group), capped. `[]` on any failure (graceful + honest). */
export async function fetchVisibleSatellites(limit = 12): Promise<Tle[]> {
  try {
    const res = await fetch(CELESTRAK_VISUAL, { next: { revalidate: 43_200 } });
    if (!res.ok) return [];
    const text = await res.text();
    const tles = parseTle(text);
    // ISS first (the marquee pass), then the rest, capped to keep propagation cheap.
    tles.sort((a, b) => (a.name.includes('ISS') ? -1 : b.name.includes('ISS') ? 1 : 0));
    return tles.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Canonical, checksum-valid ISS TLE (epoch 2008-09-20) — TEST FIXTURE ONLY. Propagate near its epoch in
 * unit tests so SGP4 stays valid. Deliberately NOT wired into runtime: an 18-year-stale TLE would
 * fabricate wrong passes, violating the honesty policy (ADR-043) — live fetch failures return `[]`.
 */
export const SAMPLE_ISS_TLE: Tle = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
};
