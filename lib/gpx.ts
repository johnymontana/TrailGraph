/**
 * GPX 1.1 generation for trip export (ADR-048). Pure + deterministic (no I/O, no Date.now — pass
 * `time`), mirroring lib/ics.ts so it unit-tests the same way. Emits waypoints + a single connector
 * track. HONESTY (ADR-043): the OpenRouteService matrix returns distance/time only — NO route geometry —
 * so the track is a straight stop-to-stop connector, never implied to be turn-by-turn road geometry.
 */
export interface GpxWaypoint {
  lat: number;
  lon: number;
  name: string;
  desc?: string;
  type?: string;
}
export interface GpxTrackPoint {
  lat: number;
  lon: number;
}
export interface GpxTrackSeg {
  name: string;
  points: GpxTrackPoint[];
}

/** Escape XML text/attribute content. */
function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 6 dp ≈ 0.1 m — deterministic, avoids float noise in snapshots/tests. */
function coord(n: number): string {
  return n.toFixed(6);
}

export function generateGPX(
  meta: { name: string; time: string; desc?: string },
  waypoints: GpxWaypoint[],
  tracks: GpxTrackSeg[],
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="TrailGraph" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${xmlEsc(meta.name)}</name>`,
    `    <time>${xmlEsc(meta.time)}</time>`,
  ];
  if (meta.desc) lines.push(`    <desc>${xmlEsc(meta.desc)}</desc>`);
  lines.push('  </metadata>');
  for (const w of waypoints) {
    lines.push(`  <wpt lat="${coord(w.lat)}" lon="${coord(w.lon)}">`);
    lines.push(`    <name>${xmlEsc(w.name)}</name>`);
    if (w.desc) lines.push(`    <desc>${xmlEsc(w.desc)}</desc>`);
    if (w.type) lines.push(`    <type>${xmlEsc(w.type)}</type>`);
    lines.push('  </wpt>');
  }
  for (const t of tracks) {
    if (!t.points.length) continue;
    lines.push('  <trk>');
    lines.push(`    <name>${xmlEsc(t.name)}</name>`);
    lines.push('    <trkseg>');
    for (const p of t.points) lines.push(`      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lon)}"></trkpt>`);
    lines.push('    </trkseg>');
    lines.push('  </trk>');
  }
  lines.push('</gpx>');
  return lines.join('\n') + '\n';
}
