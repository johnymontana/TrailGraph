import { describe, it, expect } from 'vitest';
import { summarizeHits, campAlertEmailHtml, type CampAlertHit } from './camp-alert-email';
import type { CampWatch } from './camp-watches';

const watch: CampWatch = {
  id: 'w1', userId: 'u1', campgroundIds: ['cg-canyon'], recAreaId: null,
  startDate: '2026-07-03', endDate: '2026-07-05', nights: 2, minNights: null,
  siteType: 'tent', weekendOnly: false, hookups: null, ada: false, active: true,
  lastNotifiedAt: null, lastSnapshot: null, label: 'North Rim weekend', createdAt: null,
};

describe('summarizeHits', () => {
  it('collapses per-(campground,date) and sorts dates', () => {
    const hits: CampAlertHit[] = [
      { campgroundId: 'cg-canyon', campgroundName: 'Canyon', date: '2026-07-05', bookingUrl: 'u' },
      { campgroundId: 'cg-canyon', campgroundName: 'Canyon', date: '2026-07-03', bookingUrl: 'u' },
      { campgroundId: 'cg-other', campgroundName: 'Other', date: '2026-07-03', bookingUrl: 'v' },
    ];
    const out = summarizeHits(hits);
    expect(out).toHaveLength(2);
    const canyon = out.find((g) => g.campgroundName === 'Canyon')!;
    expect(canyon.dates).toEqual(['2026-07-03', '2026-07-05']);
  });
});

describe('campAlertEmailHtml', () => {
  it('includes a Book now link, the watch label, and the unofficial-source disclaimer', () => {
    const html = campAlertEmailHtml(watch, [{ campgroundId: 'cg-canyon', campgroundName: 'Canyon', date: '2026-07-03', bookingUrl: 'https://recreation.gov/x' }], 'https://trailgraph.app/api/unsubscribe?token=t');
    expect(html).toContain('Book now ↗');
    expect(html).toContain('North Rim weekend');
    expect(html).toContain('https://recreation.gov/x');
    expect(html).toContain('unofficial');
    expect(html).toContain('Unsubscribe');
  });
  it('escapes HTML in campground names', () => {
    const html = campAlertEmailHtml(watch, [{ campgroundId: 'x', campgroundName: '<script>bad</script>', date: '2026-07-03', bookingUrl: 'u' }], 'u');
    expect(html).not.toContain('<script>bad');
    expect(html).toContain('&lt;script&gt;');
  });
});
