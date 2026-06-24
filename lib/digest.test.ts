import { describe, it, expect } from 'vitest';
import { feeFreeDaysForYear, upcomingFeeFree, darkSkyDigestItem, roadClosureItems } from './digest';
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
});

describe('darkSkyDigestItem (ADR-052)', () => {
  it('fires only on a dim moon with a real dark window', () => {
    expect(darkSkyDigestItem(astro(8, 6), 'grba', 'Great Basin')?.tone).toBe('good');
    expect(darkSkyDigestItem(astro(60, 6), 'grba', 'Great Basin')).toBeNull(); // bright moon
    expect(darkSkyDigestItem(astro(8, 2), 'grba', 'Great Basin')).toBeNull(); // too little darkness
    expect(darkSkyDigestItem(astro(8, null), 'grba', 'Great Basin')).toBeNull(); // no dark window
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
