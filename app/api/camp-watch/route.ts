import { Resend } from 'resend';
import { assertCron } from '../../../lib/cron-auth';
import { env } from '../../../lib/env';
import {
  usersWithCampWatches,
  expireCampWatches,
  recordCampWatchSnapshot,
  freshOpenings,
  type CampWatch,
} from '../../../lib/camp-watches';
import { getCampgroundAvailability, enumerateNights } from '../../../lib/datasources/campAvailability';
import { campgroundDetail } from '../../../lib/campgrounds';
import { recreationUrl } from '../../../lib/datasources/recreation';
import { appendDigestItem } from '../../../lib/digest';
import { campAlertEmailHtml, type CampAlertHit } from '../../../lib/camp-alert-email';

/**
 * Camp Watch poller (Campgrounds feature, Phase 2). A SEPARATE cron from the daily digest (availability
 * changes by the minute): every 15 min it scans active, non-expired `:CampWatch`es, fetches availability
 * for each watched campground (backoff-aware, bounded), diffs the set of open `campgroundId|date|siteId`
 * keys against the watch's `lastSnapshot`, and on a FRESH opening drops an item into the in-app inbox +
 * (opt-in) sends a Resend "a site opened" email with a one-tap Book ↗ link. Throttled (`lastNotifiedAt`,
 * 30-min mute) so a still-open site doesn't re-alert. Returns early when the availability flag is off.
 *
 * Mirrors /api/digests (assertCron + maxDuration + Resend opt-in). Never books or holds anything.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const MUTE_MS = 30 * 60_000;
const MAX_CAMPGROUNDS_PER_WATCH = 20;

function isWeekendNight(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  return d === 5 || d === 6; // Fri / Sat nights
}

export async function GET(req: Request) {
  const deny = assertCron(req);
  if (deny) return deny;

  const expired = await expireCampWatches();
  if (!env.camp.availabilityEnabled) {
    return Response.json({ skipped: 'availability disabled', expired });
  }

  const baseUrl = process.env.BETTER_AUTH_URL ?? 'https://trailgraph.app';
  const emailFrom = process.env.EMAIL_FROM;
  const rows = await usersWithCampWatches();

  // Resolve campground metadata (ridbId / name / bookingUrl) once across all watches.
  const cgCache = new Map<string, { ridbId: string | null; name: string; bookingUrl: string | null }>();
  const resolveCg = async (id: string) => {
    if (cgCache.has(id)) return cgCache.get(id)!;
    const d = await campgroundDetail(id).catch(() => null);
    const meta = d
      ? { ridbId: d.ridbId, name: d.name, bookingUrl: d.reservationUrl ?? (d.ridbId ? recreationUrl(d.ridbId) : null) }
      : { ridbId: null, name: id, bookingUrl: null };
    cgCache.set(id, meta);
    return meta;
  };

  let polled = 0;
  let matched = 0;
  let emailed = 0;

  for (const { watch, email, emailOptIn, unsubToken } of rows) {
    const nights = enumerateNights(watch.startDate, watch.endDate).filter((d) => !watch.weekendOnly || isWeekendNight(d));
    if (!nights.length) continue;
    const months = [...new Set(nights.map((d) => d.slice(0, 7)))];
    const nightSet = new Set(nights);

    const openKeys = new Set<string>(); // "campgroundId|date|siteId"

    for (const cgId of (watch.campgroundIds ?? []).slice(0, MAX_CAMPGROUNDS_PER_WATCH)) {
      const meta = await resolveCg(cgId);
      if (!meta.ridbId) continue;
      for (const m of months) {
        const data = await getCampgroundAvailability(meta.ridbId, `${m}-01`);
        polled++;
        if (!data) continue; // backoff/disabled/error → skip silently
        for (const [siteId, byDate] of Object.entries(data.perSite)) {
          if (watch.siteType && watch.siteType !== 'any' && data.siteType[siteId] !== watch.siteType) continue;
          for (const d of Object.keys(byDate)) {
            if (byDate[d] === 'open' && nightSet.has(d)) openKeys.add(`${cgId}|${d}|${siteId}`);
          }
        }
      }
    }

    const fresh = freshOpenings(watch.lastSnapshot, [...openKeys]);
    const muted = watch.lastNotifiedAt != null && Date.now() - Date.parse(watch.lastNotifiedAt) < MUTE_MS;
    let notified = false;

    if (fresh.length && !muted) {
      matched++;
      // Reconstruct per-(campground,date) alert hits from the fresh keys (siteId dropped for display).
      const freshHits: CampAlertHit[] = fresh.map((k) => {
        const [cgId, date] = k.split('|');
        const meta = cgCache.get(cgId);
        return { campgroundId: cgId, campgroundName: meta?.name ?? cgId, date, bookingUrl: meta?.bookingUrl ?? baseUrl };
      });
      const names = [...new Set(freshHits.map((h) => h.campgroundName))].slice(0, 3).join(', ');
      await appendDigestItem(watch.userId, {
        kind: 'campavail',
        title: `A campsite opened for ${watch.label ?? 'your watch'}`,
        detail: `${fresh.length} newly-open site-night${fresh.length === 1 ? '' : 's'} at ${names}. Book on recreation.gov before it's gone.`,
        tone: 'good',
      }).catch(() => {});
      notified = true;

      if (emailOptIn && email && unsubToken && resend && emailFrom) {
        const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
        try {
          await resend.emails.send({
            from: emailFrom,
            to: email,
            subject: `🏕️ A site opened for ${watch.label ?? 'your watch'}`,
            html: campAlertEmailHtml(watch as CampWatch, freshHits, unsubscribeUrl),
          });
          emailed++;
        } catch {
          // a failed send shouldn't abort the fan-out
        }
      }
    }

    // Always persist the snapshot so the next diff is correct even when muted/disabled-by-throttle.
    await recordCampWatchSnapshot(watch.id, JSON.stringify([...openKeys]), notified).catch(() => {});
  }

  return Response.json({ watches: rows.length, polled, matched, emailed, expired });
}
