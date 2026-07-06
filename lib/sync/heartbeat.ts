/**
 * Time-throttled progress logger for the long-running per-park sync crawls (trail GIS fetch ~474 parks,
 * elevation sampling at ~1 batch/sec for hours): logs at most once per `intervalMs` so a national run
 * emits a status line every ~30s instead of hours of silence or a line per sample. `force` bypasses the
 * throttle for start/stop/milestone lines. Lines carry the given `prefix` tag + elapsed time.
 */
export function makeHeartbeat(prefix: string, intervalMs = 30_000) {
  const startedAt = Date.now();
  let lastAt = 0;
  return (line: () => string, force = false) => {
    const now = Date.now();
    if (!force && now - lastAt < intervalMs) return;
    lastAt = now;
    const mins = (now - startedAt) / 60_000;
    const elapsed = mins < 1 ? `${Math.round(mins * 60)}s` : `${mins.toFixed(1)}min`;
    console.log(`[${prefix}] ${line()} — ${elapsed} elapsed`);
  };
}
