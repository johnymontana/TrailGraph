import { describe, it, expect } from 'vitest';
import { mapStatus, enumerateNights, countOpenNights, type CampMonthAvailability } from './campAvailability';

describe('mapStatus (rec.gov label → coarse status)', () => {
  it('maps the common labels', () => {
    expect(mapStatus('Available')).toBe('open');
    expect(mapStatus('Reserved')).toBe('reserved');
    expect(mapStatus('Not Available')).toBe('closed');
    expect(mapStatus('Not Reservable')).toBe('closed');
    expect(mapStatus('Closed')).toBe('closed');
    expect(mapStatus('NYR')).toBe('closed');
    expect(mapStatus('weird')).toBe('unknown');
  });
  it('does not mistake "Not Available" for open', () => {
    expect(mapStatus('Not Available')).not.toBe('open');
  });
});

describe('enumerateNights', () => {
  it('lists each night inclusive', () => {
    expect(enumerateNights('2026-07-03', '2026-07-05')).toEqual(['2026-07-03', '2026-07-04', '2026-07-05']);
  });
  it('single night', () => {
    expect(enumerateNights('2026-07-03', '2026-07-03')).toEqual(['2026-07-03']);
  });
  it('returns [] for reversed or bad input', () => {
    expect(enumerateNights('2026-07-05', '2026-07-03')).toEqual([]);
    expect(enumerateNights('garbage', '2026-07-03')).toEqual([]);
  });
  it('caps the window at 60 nights', () => {
    expect(enumerateNights('2026-01-01', '2026-12-31').length).toBe(60);
  });
});

function month(days: { date: string; sitesOpen: number; byType?: Record<string, number> }[], perSite: CampMonthAvailability['perSite'] = {}, siteType: CampMonthAvailability['siteType'] = {}): CampMonthAvailability {
  return {
    ridbId: '1',
    monthStart: '2026-07-01',
    days: days.map((d) => ({ date: d.date, sitesOpen: d.sitesOpen, byType: d.byType ?? { tent: d.sitesOpen } })),
    perSite,
    siteType,
    fetchedAt: '2026-07-01T00:00:00Z',
  };
}

describe('countOpenNights', () => {
  const nights = ['2026-07-03', '2026-07-04', '2026-07-05'];

  it('counts open nights and distinct open sites', () => {
    const m = month(
      [
        { date: '2026-07-03', sitesOpen: 2 },
        { date: '2026-07-05', sitesOpen: 1 },
      ],
      { s1: { '2026-07-03': 'open', '2026-07-05': 'open' }, s2: { '2026-07-03': 'open' } },
      { s1: 'tent', s2: 'tent' },
    );
    const r = countOpenNights([m], nights);
    expect(r.nightsOpen).toBe(2); // 03 + 05 open (04 closed)
    expect(r.sampleSiteCount).toBe(2); // s1, s2
  });

  it('honors a siteType filter via byType', () => {
    const m = month([{ date: '2026-07-03', sitesOpen: 1, byType: { rv: 1 } }], { s1: { '2026-07-03': 'open' } }, { s1: 'rv' });
    expect(countOpenNights([m], nights, { siteType: 'tent' }).nightsOpen).toBe(0);
    expect(countOpenNights([m], nights, { siteType: 'rv' }).nightsOpen).toBe(1);
  });

  it('minNights requires a consecutive run', () => {
    // 03 + 05 open but NOT 04 → no 2-night consecutive run.
    const split = month([
      { date: '2026-07-03', sitesOpen: 1 },
      { date: '2026-07-05', sitesOpen: 1 },
    ]);
    expect(countOpenNights([split], nights, { minNights: 2 }).nightsOpen).toBe(0);
    // 03 + 04 consecutive → a 2-night run counts both.
    const run = month([
      { date: '2026-07-03', sitesOpen: 1 },
      { date: '2026-07-04', sitesOpen: 1 },
    ]);
    expect(countOpenNights([run], nights, { minNights: 2 }).nightsOpen).toBe(2);
  });

  it('treats all-null months as zero open', () => {
    expect(countOpenNights([null, null], nights)).toEqual({ nightsOpen: 0, sampleSiteCount: 0 });
  });
});
