import { readGraph, writeGraph } from '../neo4j';

/**
 * Recreation.gov reservations (§5d) — link-out only (NG1: no booking in v1). The NPS sync already
 * gives most campgrounds a `reservationUrl`; for recreation.gov URLs the RIDB facility id is embedded
 * in the path (`/camping/campgrounds/<ridbId>`). We extract that into a structured `:Campground.ridbId`
 * (no invented links, R6) so the UI can deep-link and a future live RIDB import can attach availability.
 * The curated `RIDB` map is an optional override for campgrounds NPS doesn't give a URL.
 */
export interface RidbRecord {
  campgroundId: string; // our :Campground.id (NPS GUID)
  ridbId: string; // Recreation.gov facility id
}

/** Build the public Recreation.gov campground URL for a RIDB facility id. Pure (unit-tested). */
export function recreationUrl(ridbId: string): string {
  return `https://www.recreation.gov/camping/campgrounds/${encodeURIComponent(ridbId)}`;
}

/** Extract the RIDB facility id from a recreation.gov campground URL. Pure (unit-tested). */
export function parseRidbId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /recreation\.gov\/camping\/campgrounds\/(\d+)/i.exec(url);
  return m ? m[1] : null;
}

// Optional overrides for campgrounds NPS doesn't give a reservation URL (keyed by :Campground.id).
export const RIDB: RidbRecord[] = [];

export async function applyReservations(records: RidbRecord[] = RIDB): Promise<number> {
  let applied = 0;

  // 1) The common case: derive a structured ridbId from the recreation.gov URL NPS already provides.
  const rows = await readGraph<{ id: string; url: string }>(
    `MATCH (c:Campground)
     WHERE c.reservationUrl CONTAINS 'recreation.gov'
     RETURN c.id AS id, c.reservationUrl AS url`,
  );
  for (const r of rows) {
    const ridbId = parseRidbId(r.url);
    if (!ridbId) continue;
    await writeGraph(`MATCH (c:Campground {id:$id}) SET c.ridbId = $ridbId`, { id: r.id, ridbId });
    applied++;
  }

  // 2) Curated overrides: set a reservation URL where one is missing (no-op against real data unless
  //    the curated ids match; primarily for seed/demo).
  for (const rec of records) {
    const res = await writeGraph<{ id: string }>(
      `MATCH (c:Campground {id:$campgroundId})
       SET c.ridbId = $ridbId, c.reservationUrl = coalesce(c.reservationUrl, $url)
       RETURN c.id AS id`,
      { campgroundId: rec.campgroundId, ridbId: rec.ridbId, url: recreationUrl(rec.ridbId) },
    );
    if (res.length) applied++;
  }
  return applied;
}
