import { randomUUID } from 'node:crypto';
import { readGraph, writeGraph } from './neo4j';
import { listWatches } from './watches';
import { getTrip } from './trips';
import { parkDetail, eventsForPark, newsForPark } from './queries';
import { getAstro, getConditions, type AstroEvents, type RoadEvent } from './datasources';

/**
 * Proactive Ranger digest builder (ADR-052). Walks a user's watches → resolves the watched parks →
 * rolls up road/gate closures, clear-sky-on-new-moon windows, fee-free days, and active Closure/Danger
 * alerts into a per-day :Digest in the in-app inbox. The pure assembly helpers (fee-free lookup, dark-sky
 * gate, road-closure mapping) are unit-tested; the orchestration is integration-tested. Surfaces only;
 * never an official safety source (defers to NPS, per the agent's hard rules).
 */

export type DigestItemKind = 'closure' | 'alert' | 'darksky' | 'feefree' | 'event' | 'news';

export interface DigestItem {
  kind: DigestItemKind;
  parkCode?: string;
  parkName?: string;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'info';
}

export interface Digest {
  id: string;
  forDate: string;
  read: boolean;
  items: DigestItem[];
  createdAt: string | null;
}

// ---- pure helpers (unit-tested) ------------------------------------------------------------------

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  const firstOffset = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(1 + firstOffset + (nth - 1) * 7);
  return d.toISOString().slice(0, 10);
}

/** Curated NPS fee-free entrance days (~6/yr), generated per year to avoid annual hard-coded refreshes. */
export function feeFreeDaysForYear(year: number): { date: string; name: string }[] {
  return [
    { date: nthWeekdayOfMonth(year, 0, 1, 3), name: 'Martin Luther King Jr. Day' }, // 3rd Monday in Jan
    { date: nthWeekdayOfMonth(year, 3, 6, 3), name: 'First day of National Park Week' }, // 3rd Saturday in Apr
    { date: `${year}-06-19`, name: 'Juneteenth' },
    { date: `${year}-08-04`, name: 'Great American Outdoors Act anniversary' },
    { date: nthWeekdayOfMonth(year, 8, 6, 4), name: 'National Public Lands Day' }, // 4th Saturday in Sep
    { date: `${year}-11-11`, name: 'Veterans Day' },
  ];
}

/** Backward-compatible export retained for tests/imports. */
export const FEE_FREE_DAYS = feeFreeDaysForYear(2026);

/** The next fee-free day on/after `ymd` within `windowDays`, else null. Pure. */
export function upcomingFeeFree(ymd: string, windowDays = 21): { date: string; name: string } | null {
  const start = new Date(`${ymd}T00:00:00Z`);
  const base = start.getTime();
  const horizon = base + windowDays * 86_400_000;
  const horizonDate = new Date(horizon);
  const years: number[] = [];
  for (let year = start.getUTCFullYear(); year <= horizonDate.getUTCFullYear(); year++) years.push(year);
  const upcoming = years
    .flatMap((year) => feeFreeDaysForYear(year))
    .map((f) => ({ ...f, ms: Date.parse(`${f.date}T00:00:00Z`) }))
    .filter((f) => f.ms >= base && f.ms <= horizon)
    .sort((a, b) => a.ms - b.ms);
  return upcoming.length ? { date: upcoming[0].date, name: upcoming[0].name } : null;
}

/** A clear-sky-on-new-moon window is "good news" worth a nudge: dim moon + a real dark window. Pure. */
export function darkSkyDigestItem(astro: AstroEvents, parkCode: string, parkName: string): DigestItem | null {
  if (astro.moon.illuminationPct >= 25) return null;
  if (astro.darkHours.hours == null || astro.darkHours.hours < 4) return null;
  return {
    kind: 'darksky',
    parkCode,
    parkName,
    title: `Dark-sky window at ${parkName}`,
    detail: `Tonight: ${astro.moon.illuminationPct}% moon and ~${astro.darkHours.hours} h of astronomical darkness — a near-new-moon stargazing window.`,
    tone: 'good',
  };
}

/** Significant road events (severity rank ≥ 2 = major/closure) become digest "warn" items. Pure. */
export function roadClosureItems(events: RoadEvent[], parkCode: string, parkName: string): DigestItem[] {
  return events
    .filter((e) => e.severityRank >= 2)
    .slice(0, 3)
    .map((e) => ({
      kind: 'closure' as const,
      parkCode,
      parkName,
      title: `Road status at ${parkName}`,
      detail: `${e.title} (${e.severity})`,
      tone: 'warn' as const,
    }));
}

/**
 * Events become "info" digest items (F4/P1-1). When the watched park came from a trip with a date window,
 * only events that fall inside it are surfaced ("3 ranger programs during your visit"); otherwise the
 * next few upcoming events. Pure (unit-tested).
 */
export function eventDigestItems(
  events: { id: string; title: string; dateStart: string | null; inWindow: boolean; isFree: boolean | null; types: string[] }[],
  parkCode: string,
  parkName: string,
  hasWindow: boolean,
): DigestItem[] {
  const picked = hasWindow ? events.filter((e) => e.inWindow) : events;
  return picked.slice(0, 3).map((e) => ({
    kind: 'event' as const,
    parkCode,
    parkName,
    title: `Event at ${parkName}: ${e.title}`,
    detail: [e.dateStart, e.types?.[0], e.isFree ? 'free' : null].filter(Boolean).join(' · '),
    tone: 'info' as const,
  }));
}

/** Recent news releases (within `withinDays` of `asOf`) become "info" digest items (F8/P1-1). Pure. */
export function newsDigestItems(
  news: { id: string; title: string; releaseDate: string | null }[],
  parkCode: string,
  parkName: string,
  asOf: string,
  withinDays = 14,
): DigestItem[] {
  const cutoff = Date.parse(`${asOf}T00:00:00Z`) - withinDays * 86_400_000;
  return news
    .filter((n) => n.releaseDate && Date.parse(`${n.releaseDate}T00:00:00Z`) >= cutoff)
    .slice(0, 2)
    .map((n) => ({ kind: 'news' as const, parkCode, parkName, title: `News from ${parkName}`, detail: n.title, tone: 'info' as const }));
}

// ---- orchestration -------------------------------------------------------------------------------

interface WatchedPark {
  parkCode: string;
  name: string;
  lat: number | null;
  lng: number | null;
  window: { start: string | null; end: string | null } | null; // trip travel window (P1-1), if any
}

/** Resolve the distinct parks behind a user's watches (trip stops + watched parks). */
async function watchedParks(userId: string): Promise<WatchedPark[]> {
  const watches = await listWatches(userId);
  const parks = new Map<string, WatchedPark>();
  for (const w of watches) {
    if (w.kind === 'park') {
      const p = await parkDetail(w.refId);
      if (p) {
        const prev = parks.get(w.refId);
        parks.set(w.refId, { parkCode: w.refId, name: (p.name as string) ?? w.refId, lat: p.lat as number | null, lng: p.lng as number | null, window: prev?.window ?? null });
      }
    } else {
      const t = await getTrip(userId, w.refId);
      // Carry the trip's travel window so events/news can be filtered to "during your visit" (P1-1).
      const window = t?.startDate ? { start: t.startDate, end: t.endDate ?? t.startDate } : null;
      for (const s of (t?.stops ?? []).filter(Boolean)) {
        if (s.kind === 'park' && s.parkCode) {
          const prev = parks.get(s.parkCode);
          parks.set(s.parkCode, { parkCode: s.parkCode, name: s.parkName ?? s.parkCode, lat: s.lat, lng: s.lng, window: window ?? prev?.window ?? null });
        }
      }
    }
  }
  // Cap parks resolved per digest (audit C8): bounds per-park NPS/conditions fetches so one heavy user
  // can't lengthen the 300s digest cron. The per-user watch cap (WATCH_CAP) already bounds this; this
  // is the belt-and-suspenders limit on distinct parks.
  return [...parks.values()].slice(0, 50);
}

/**
 * Build (and persist) today's digest for a user from their watches. Returns the digest. Idempotent per
 * forDate (re-running overwrites the items). Returns an empty digest (not persisted) when there are no
 * watches.
 */
export async function buildDigest(userId: string, forDate?: string): Promise<Digest> {
  const date = (forDate ?? new Date().toISOString()).slice(0, 10);
  const parks = await watchedParks(userId);
  const items: DigestItem[] = [];

  const ff = upcomingFeeFree(date);
  if (ff) {
    items.push({ kind: 'feefree', title: `Fee-free day: ${ff.name}`, detail: `${ff.name} (${ff.date}) — entrance fees are waived at all national parks.`, tone: 'good' });
  }

  for (const p of parks) {
    const alerts = await readGraph<{ category: string; title: string }>(
      `MATCH (a:Alert)-[:AFFECTS]->(:Park {parkCode:$parkCode})
       WHERE a.active = true AND a.category IN ['Closure','Danger']
       RETURN a.category AS category, a.title AS title LIMIT 3`,
      { parkCode: p.parkCode },
    );
    for (const a of alerts) {
      items.push({ kind: 'alert', parkCode: p.parkCode, parkName: p.name, title: `${a.category} at ${p.name}`, detail: a.title, tone: 'warn' });
    }
    const cond = await getConditions(p.parkCode).catch(() => null);
    if (cond) items.push(...roadClosureItems(cond.roadEvents, p.parkCode, p.name));
    if (p.lat != null && p.lng != null) {
      const item = darkSkyDigestItem(getAstro(p.lat, p.lng, date), p.parkCode, p.name);
      if (item) items.push(item);
    }
    // F4 events during the trip window + F8 recent news for the park (P1-1).
    const events = await eventsForPark(p.parkCode, p.window ?? { start: null, end: null }).catch(() => []);
    items.push(...eventDigestItems(events, p.parkCode, p.name, !!p.window));
    const news = await newsForPark(p.parkCode, 3).catch(() => []);
    items.push(...newsDigestItems(news, p.parkCode, p.name, date));
  }

  if (!parks.length) {
    return { id: '', forDate: date, read: false, items, createdAt: null };
  }

  const id = randomUUID();
  const rows = await writeGraph<{ id: string }>(
    `
    MERGE (u:User {userId:$userId})
    MERGE (u)-[:HAS_DIGEST]->(d:Digest {userId:$userId, forDate:$date})
      ON CREATE SET d.id = $id, d.createdAt = datetime(), d.read = false
    SET d.items = $items, d.itemCount = $count
    RETURN d.id AS id
    `,
    { userId, date, id, items: JSON.stringify(items), count: items.length },
  );
  return { id: rows[0]?.id ?? id, forDate: date, read: false, items, createdAt: null };
}

// ---- inbox reads ---------------------------------------------------------------------------------

export async function listDigests(userId: string, limit = 30): Promise<Digest[]> {
  const rows = await readGraph<{ id: string; forDate: string; read: boolean; items: string; createdAt: string | null }>(
    `MATCH (:User {userId:$userId})-[:HAS_DIGEST]->(d:Digest)
     RETURN d.id AS id, d.forDate AS forDate, coalesce(d.read, false) AS read, d.items AS items, toString(d.createdAt) AS createdAt
     ORDER BY d.forDate DESC LIMIT toInteger($limit)`,
    { userId, limit },
  );
  return rows.map((r) => ({
    id: r.id,
    forDate: r.forDate,
    read: r.read,
    createdAt: r.createdAt,
    items: safeParse(r.items),
  }));
}

export async function unreadDigestCount(userId: string): Promise<number> {
  const rows = await readGraph<{ n: number }>(
    `MATCH (:User {userId:$userId})-[:HAS_DIGEST]->(d:Digest) WHERE coalesce(d.read, false) = false RETURN count(d) AS n`,
    { userId },
  );
  return Number(rows[0]?.n ?? 0);
}

export async function markDigestRead(userId: string, digestId: string): Promise<void> {
  await writeGraph(
    `MATCH (:User {userId:$userId})-[:HAS_DIGEST]->(d:Digest {id:$digestId}) SET d.read = true`,
    { userId, digestId },
  );
}

export async function setEmailDigest(userId: string, value: boolean): Promise<void> {
  // Mint a stable, unguessable unsubscribe token on first enable so digest emails carry a one-click
  // unsubscribe (ADR-052) that needs no login.
  await writeGraph(
    `MERGE (u:User {userId:$userId}) SET u.emailDigest = $value, u.unsubToken = coalesce(u.unsubToken, $token)`,
    { userId, value, token: randomUUID() },
  );
}

/** One-click email unsubscribe by opaque token (no login). Returns true if a user matched. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!token) return false;
  const rows = await writeGraph<{ ok: boolean }>(
    `MATCH (u:User {unsubToken:$token}) SET u.emailDigest = false RETURN true AS ok`,
    { token },
  );
  return rows.length > 0;
}

export async function getEmailDigest(userId: string): Promise<boolean> {
  const rows = await readGraph<{ on: boolean }>(
    `MATCH (u:User {userId:$userId}) RETURN coalesce(u.emailDigest, false) AS on`,
    { userId },
  );
  return rows[0]?.on ?? false;
}

function safeParse(s: string | null): DigestItem[] {
  if (!s) return [];
  try {
    return JSON.parse(s) as DigestItem[];
  } catch {
    return [];
  }
}
