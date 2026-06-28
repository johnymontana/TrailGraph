import { describe, it, expect, vi, afterEach } from 'vitest';
import { mapStatus, enumerateNights, countOpenNights, getCampgroundAvailability, type CampMonthAvailability } from './campAvailability';

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

// getCampgroundAvailability has module-level backoff state (cooldown after a 429), so the 429 test runs LAST.
describe('getCampgroundAvailability (gated live fetch)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CAMP_AVAILABILITY_ENABLED;
  });

  it('returns null without fetching when the flag is OFF (kill-switch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getCampgroundAvailability('232449', '2030-07-15')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses per-site availability into days + perSite + byType when enabled', async () => {
    process.env.CAMP_AVAILABILITY_ENABLED = '1';
    const body = {
      campsites: {
        s1: { campsite_type: 'TENT', availabilities: { '2030-07-03T00:00:00Z': 'Available', '2030-07-04T00:00:00Z': 'Reserved' } },
        s2: { campsite_type: 'RV', availabilities: { '2030-07-03T00:00:00Z': 'Available' } },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
    const r = (await getCampgroundAvailability('232449', '2030-07-20'))!;
    expect(r.ridbId).toBe('232449');
    expect(r.monthStart).toBe('2030-07-01'); // normalized to the 1st
    expect(r.perSite.s1['2030-07-03']).toBe('open');
    expect(r.perSite.s1['2030-07-04']).toBe('reserved');
    const day3 = r.days.find((d) => d.date === '2030-07-03')!;
    expect(day3.sitesOpen).toBe(2); // s1 + s2 open on the 3rd
    expect(day3.byType).toMatchObject({ tent: 1, rv: 1 });
    expect(r.siteType.s2).toBe('rv');
  });

  it('returns null on a non-ok response (degrades to a deep link upstream)', async () => {
    process.env.CAMP_AVAILABILITY_ENABLED = '1';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await getCampgroundAvailability('1', '2030-07-01')).toBeNull();
  });

  it('returns null on a 429 and arms the backoff cooldown (runs last)', async () => {
    process.env.CAMP_AVAILABILITY_ENABLED = '1';
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getCampgroundAvailability('1', '2030-07-01')).toBeNull();
    // The cooldown is now armed → the next call short-circuits to null WITHOUT a second fetch.
    expect(await getCampgroundAvailability('1', '2030-07-01')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
