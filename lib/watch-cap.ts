/**
 * Per-user watch cap (audit C8) — bounds the daily digest fan-out + per-park NPS fetches. Kept in its own
 * dependency-free module so it can be imported by BOTH the server (`lib/watches.ts`, which pulls neo4j) and
 * the client `WatchListCard` (which must not), letting the UI surface "N / CAP" without a server import.
 */
export const WATCH_CAP = 25;
