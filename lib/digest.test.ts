import { describe, it, expect } from 'vitest';
import { feeFreeDaysForYear, upcomingFeeFree, darkSkyDigestItem, roadClosureItems, eventDigestItems, newsDigestItems } from './digest';
import { digestEmailHtml } from './digest-email';
import type { AstroEvents, RoadEvent } from './datasources';

function astro(moonPct: number, darkHours: number | null): AstroEvents {
  return {
    date: '2026-06-23',
    moon: { phaseName: 'New', phaseAngleDeg: 0, illuminationPct: moonPct, emoji: '🌑', rise: null, set: null },
    sun: { rise: null, set: null },
    twilight: { civilDusk: null, nauticalDusk: null, astronomicalDusk: null, astronomicalDawn: null, nauticalDawn: null, civilDawn: null },
    darkHours: { start: null, end: null, hours: darkHours },
    galacticCore: { rise: null, set: null, riseAzimuthDeg: null, maxAltitudeDeg: null, visible: false },
  };
}

describe('upcomingFeeFree (ADR-052)', () => {
  it('finds the next fee-free day within the window', () => {
    const ff = upcomingFeeFree('2026-06-10', 21); // Juneteenth 2026-06-19 is 9 days out
    expect(ff?.date).toBe('2026-06-19');
  });
  it('returns null when none fall inside the window', () => {
    expect(upcomingFeeFree('2026-06-23', 7)).toBeNull(); // next is Aug 4
  });
  it('works for future years without hard-coded annual updates', () => {
    const ff = upcomingFeeFree('2027-01-10', 14);
    expect(ff).toEqual({ date: '2027-01-18', name: 'Martin Luther King Jr. Day' });
  });
});

describe('feeFreeDaysForYear', () => {
  it('generates the known 2026 dates', () => {
    expect(feeFreeDaysForYear(2026)).toEqual([
      { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
      { date: '2026-04-18', name: 'First day of National Park Week' },
      { date: '2026-06-19', name: 'Juneteenth' },
      { date: '2026-08-04', name: 'Great American Outdoors Act anniversary' },
      { date: '2026-09-26', name: 'National Public Lands Day' },
      { date: '2026-11-11', name: 'Veterans Day' },
    ]);
  });
  it('includes a fee-free day that is exactly today', () => {
    expect(upcomingFeeFree('2026-06-19', 0)?.date).toBe('2026-06-19');
  });
  it('returns null when no fee-free day falls inside the window (early Dec → next is mid-Jan)', () => {
    // After Veterans Day (Nov 11) the next fee-free day is MLK Day (~mid-Jan), so a short December
    // window has none. (A 60-day window WOULD reach next year's MLK Day, since days now generate per year.)
    expect(upcomingFeeFree('2026-12-01', 10)).toBeNull();
  });
});

describe('darkSkyDigestItem (ADR-052)', () => {
  it('fires only on a dim moon with a real dark window', () => {
    expect(darkSkyDigestItem(astro(8, 6), 'grba', 'Great Basin')?.tone).toBe('good');
    expect(darkSkyDigestItem(astro(60, 6), 'grba', 'Great Basin')).toBeNull(); // bright moon
    expect(darkSkyDigestItem(astro(8, 2), 'grba', 'Great Basin')).toBeNull(); // too little darkness
    expect(darkSkyDigestItem(astro(8, null), 'grba', 'Great Basin')).toBeNull(); // no dark window
  });
});

describe('darkSkyDigestItem boundaries (ADR-052)', () => {
  it('fires at the edges: moon < 25 AND dark hours ≥ 4', () => {
    expect(darkSkyDigestItem(astro(24, 4), 'grba', 'Great Basin')).not.toBeNull();
    expect(darkSkyDigestItem(astro(25, 6), 'grba', 'Great Basin')).toBeNull(); // moon == 25 → not "new"
    expect(darkSkyDigestItem(astro(10, 3.9), 'grba', 'Great Basin')).toBeNull(); // < 4 h
  });
});

describe('darkSkyDigestItem dating (P2.3)', () => {
  it('labels the best night in the trip window when nightDate is given', () => {
    const item = darkSkyDigestItem(astro(8, 6), 'grba', 'Great Basin', '2026-10-06');
    expect(item?.detail).toContain('On 2026-10-06');
    expect(item?.detail).toContain('trip window');
    expect(item?.detail).not.toContain('Tonight');
  });
  it('falls back to "Tonight" when no nightDate is given (watched park, no window)', () => {
    const item = darkSkyDigestItem(astro(8, 6), 'grba', 'Great Basin');
    expect(item?.detail).toContain('Tonight');
    expect(item?.detail).not.toContain('trip window');
  });
});

describe('roadClosureItems (ADR-052)', () => {
  const ev = (title: string, severityRank: number): RoadEvent => ({ id: title, title, type: 'Incident', severity: 'major', severityRank });
  it('keeps only significant (rank ≥ 2) events as warn items', () => {
    const items = roadClosureItems([ev('Going-to-the-Sun closed', 3), ev('Minor delay', 1)], 'glac', 'Glacier');
    expect(items).toHaveLength(1);
    expect(items[0].tone).toBe('warn');
    expect(items[0].detail).toContain('Going-to-the-Sun closed');
  });
  it('caps at 3 items even when many roads are closed', () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(`Road ${i} closed`, 3));
    expect(roadClosureItems(many, 'glac', 'Glacier')).toHaveLength(3);
  });
});

describe('digestEmailHtml (ADR-052)', () => {
  it('renders items + a one-click unsubscribe link', () => {
    const html = digestEmailHtml(
      [{ kind: 'feefree', title: 'Fee-free day', detail: 'Juneteenth', tone: 'good' }],
      '2026-06-19',
      'https://trailgraph.app/api/unsubscribe?token=abc',
    );
    expect(html).toContain('Fee-free day');
    expect(html).toContain('ranger digest');
    expect(html).toContain('https://trailgraph.app/api/unsubscribe?token=abc');
    expect(html).toContain('Unsubscribe');
  });
});

describe('eventDigestItems (F4 → digest, P1-1)', () => {
  const events = [
    { id: 'e1', title: 'Ranger Astronomy Night', dateStart: '2026-08-12', inWindow: true, isFree: true, types: ['Astronomy'] },
    { id: 'e2', title: 'Off-window Talk', dateStart: '2026-10-01', inWindow: false, isFree: false, types: ['Ranger Programs'] },
  ];
  it('keeps only in-window events when the park came from a dated trip', () => {
    const items = eventDigestItems(events, 'yell', 'Yellowstone', true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'event', tone: 'info' });
    expect(items[0].detail).toContain('Astronomy');
    expect(items[0].detail).toContain('free');
  });
  it('shows upcoming events (capped) when there is no window', () => {
    expect(eventDigestItems(events, 'yell', 'Yellowstone', false)).toHaveLength(2);
  });
});

describe('newsDigestItems (F8 → digest, P1-1)', () => {
  const news = [
    { id: 'n1', title: 'New road work', releaseDate: '2026-06-20' },
    { id: 'n2', title: 'Old news', releaseDate: '2026-01-01' },
  ];
  it('surfaces only releases within the recency window of the digest date', () => {
    const items = newsDigestItems(news, 'yell', 'Yellowstone', '2026-06-24', 14);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'news', tone: 'info', detail: 'New road work' });
  });
  it('drops releases with no date', () => {
    expect(newsDigestItems([{ id: 'x', title: 't', releaseDate: null }], 'yell', 'Y', '2026-06-24')).toEqual([]);
  });
});
