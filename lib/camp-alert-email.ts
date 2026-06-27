import type { CampWatch } from './camp-watches';

/**
 * Camp Watch alert email (Campgrounds feature, Phase 2) — a terse "a site opened" nudge with a one-tap
 * "Book now ↗" deep link. Only sent to users who opted in (default OFF), always with a one-click
 * unsubscribe. Availability is best-effort from an unofficial source — say so. Pure + unit-tested.
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export interface CampAlertHit {
  campgroundId: string;
  campgroundName: string;
  date: string; // YYYY-MM-DD
  bookingUrl: string;
}

/** Collapse the raw fresh "campgroundId|date|siteId" keys into per-(campground,date) lines for the email. */
export function summarizeHits(hits: CampAlertHit[]): { campgroundName: string; dates: string[]; bookingUrl: string }[] {
  const byCg = new Map<string, { campgroundName: string; dates: Set<string>; bookingUrl: string }>();
  for (const h of hits) {
    const e = byCg.get(h.campgroundId) ?? { campgroundName: h.campgroundName, dates: new Set<string>(), bookingUrl: h.bookingUrl };
    e.dates.add(h.date);
    byCg.set(h.campgroundId, e);
  }
  return [...byCg.values()].map((e) => ({ campgroundName: e.campgroundName, dates: [...e.dates].sort(), bookingUrl: e.bookingUrl }));
}

export function campAlertEmailHtml(watch: CampWatch, hits: CampAlertHit[], unsubscribeUrl: string): string {
  const groups = summarizeHits(hits);
  const rows = groups
    .map(
      (g) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e9e6;">
        <strong>🏕️ ${esc(g.campgroundName)}</strong><br/>
        <span style="color:#5a6b62;font-size:14px;">Open: ${esc(g.dates.join(', '))}</span><br/>
        <a href="${esc(g.bookingUrl)}" style="display:inline-block;margin-top:6px;color:#2f5e3f;font-weight:600;">Book now ↗</a></td></tr>`,
    )
    .join('');
  const label = watch.label ?? 'your camp watch';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1c2b24;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#2f5e3f;margin:0 0 4px;">A campsite opened up</h1>
  <p style="color:#5a6b62;font-size:13px;margin:0 0 16px;">${esc(label)} · ${watch.startDate} → ${watch.endDate}</p>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
  <p style="color:#8a978f;font-size:12px;margin-top:20px;">Availability is reported by the operator via an unofficial feed and can change in seconds — confirm on Recreation.gov before you rely on it. TrailGraph never books or holds a site for you.</p>
  <p style="color:#8a978f;font-size:12px;"><a href="${esc(unsubscribeUrl)}" style="color:#8a978f;">Unsubscribe from these emails</a></p>
</body></html>`;
}
