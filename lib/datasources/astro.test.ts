import { describe, it, expect } from 'vitest';
import { getAstro, moonPhaseName, sqmFromBortle, meteorShowers, satellitePasses, shotPlan, darkestNight } from './astro';
import { SAMPLE_ISS_TLE, parseTle } from './tle';

// Grand Canyon — a known dark-sky park with a stable lat/lng.
const GC = { lat: 36.1069, lng: -112.1129 };

describe('moonPhaseName', () => {
  it('bins the principal phases', () => {
    expect(moonPhaseName(0).name).toBe('New');
    expect(moonPhaseName(90).name).toBe('First quarter');
    expect(moonPhaseName(180).name).toBe('Full');
    expect(moonPhaseName(270).name).toBe('Last quarter');
  });
  it('wraps negatives and >360', () => {
    expect(moonPhaseName(-10).name).toBe('New');
    expect(moonPhaseName(360).name).toBe('New');
  });
});

describe('darkestNight (R5 §2.3 — best stargazing night in a trip window)', () => {
  it('returns the lowest-illumination night within the window, with its date', () => {
    // Sep 2026 new moon is ~Sep 10–11; scan a window straddling it.
    const best = darkestNight(GC.lat, GC.lng, '2026-09-05', '2026-09-20');
    expect(best.date >= '2026-09-05' && best.date <= '2026-09-20').toBe(true);
    // It is genuinely the minimum over the window (matches a brute-force scan).
    let minPct = 101;
    for (let d = 5; d <= 20; d++) {
      const ymd = `2026-09-${String(d).padStart(2, '0')}`;
      minPct = Math.min(minPct, getAstro(GC.lat, GC.lng, ymd).moon.illuminationPct);
    }
    expect(best.astro.moon.illuminationPct).toBe(minPct);
    expect(best.astro.date).toBe(best.date);
  });

  it('is deterministic and handles a single-day window', () => {
    const a = darkestNight(GC.lat, GC.lng, '2026-09-21', '2026-09-21');
    expect(a.date).toBe('2026-09-21');
    expect(a.astro.moon.illuminationPct).toBe(getAstro(GC.lat, GC.lng, '2026-09-21').moon.illuminationPct);
  });

  it('falls back to the start date for a degenerate (start > end) window', () => {
    const a = darkestNight(GC.lat, GC.lng, '2026-09-21', '2026-09-10');
    expect(a.date).toBe('2026-09-21');
  });
});

describe('sqmFromBortle', () => {
  it('is monotonic (darker Bortle → higher SQM) and always a labeled estimate', () => {
    expect(sqmFromBortle(1).sqm).toBeGreaterThan(sqmFromBortle(9).sqm);
    expect(sqmFromBortle(2).sqm).toBeGreaterThan(sqmFromBortle(4).sqm);
    for (const b of [1, 2, 5, 9]) {
      const e = sqmFromBortle(b);
      expect(e.estimate).toBe(true);
      expect(e.label).toMatch(/Bortle/);
    }
  });
  it('clamps out-of-range input', () => {
    expect(sqmFromBortle(0).sqm).toBe(sqmFromBortle(1).sqm);
    expect(sqmFromBortle(99).sqm).toBe(sqmFromBortle(9).sqm);
  });
});

describe('getAstro golden values', () => {
  it('reports ~0% illumination at a new moon (2024-04-08)', () => {
    const m = getAstro(GC.lat, GC.lng, '2024-04-08').moon;
    expect(m.illuminationPct).toBeLessThanOrEqual(2);
    expect(['New', 'Waning crescent', 'Waxing crescent']).toContain(m.phaseName);
  });
  it('reports ~100% illumination at a full moon (2024-04-23)', () => {
    const m = getAstro(GC.lat, GC.lng, '2024-04-23').moon;
    expect(m.illuminationPct).toBeGreaterThanOrEqual(98);
    expect(m.phaseName).toBe('Full');
  });
  it('has a real dark window and sunrise before sunset in spring', () => {
    const a = getAstro(GC.lat, GC.lng, '2024-04-08');
    expect(a.darkHours.hours).not.toBeNull();
    expect(a.darkHours.hours!).toBeGreaterThan(4);
    expect(a.sun.rise! < a.sun.set!).toBe(true); // ISO timestamps compare lexicographically
  });
  it('places the galactic core in the SE and above the horizon (Arizona spring)', () => {
    const c = getAstro(GC.lat, GC.lng, '2024-04-08').galacticCore;
    expect(c.visible).toBe(true);
    expect(c.maxAltitudeDeg!).toBeGreaterThan(0);
    expect(c.riseAzimuthDeg!).toBeGreaterThan(100);
    expect(c.riseAzimuthDeg!).toBeLessThan(150);
  });
  it('is deterministic for identical inputs', () => {
    const a = getAstro(GC.lat, GC.lng, '2024-04-08');
    const b = getAstro(GC.lat, GC.lng, '2024-04-08');
    expect(a).toEqual(b);
  });
  it('returns null dark hours under the midnight sun (70°N, summer solstice)', () => {
    const a = getAstro(70, 20, '2024-06-21');
    expect(a.darkHours.hours).toBeNull();
    expect(a.twilight.astronomicalDusk).toBeNull();
  });

  it('works in the southern hemisphere — the galactic core (dec −29°) rides high', () => {
    // Sydney (lat −33.8): core transit altitude ≈ 90 − |lat − dec| ≈ 85°, vs ~25° at the Grand Canyon.
    const a = getAstro(-33.8, 151.2, '2024-06-21'); // austral winter → long, dark nights
    expect(a.moon.illuminationPct).toBeGreaterThanOrEqual(0);
    expect(a.moon.illuminationPct).toBeLessThanOrEqual(100);
    expect(a.galacticCore.visible).toBe(true);
    expect(a.galacticCore.maxAltitudeDeg!).toBeGreaterThan(40);
    expect(a.darkHours.hours).not.toBeNull();
  });

  it('handles the equator (sunrise/sunset + a real dark window at equinox)', () => {
    const a = getAstro(0, 0, '2024-03-20');
    expect(a.sun.rise).not.toBeNull();
    expect(a.sun.set).not.toBeNull();
    expect(a.darkHours.hours).not.toBeNull();
  });
});

describe('meteorShowers (ADR-055)', () => {
  it('flags the Perseids at full strength on their peak night', () => {
    const showers = meteorShowers('2024-08-12');
    const perseids = showers.find((s) => s.name === 'Perseids');
    expect(perseids).toBeDefined();
    expect(perseids!.isPeakTonight).toBe(true);
    expect(perseids!.daysToPeak).toBe(0);
    expect(perseids!.intensityPct).toBe(100);
    expect(perseids!.zhr).toBe(100);
  });
  it('ramps intensity down off-peak but still inside the active window', () => {
    const pre = meteorShowers('2024-08-08').find((s) => s.name === 'Perseids');
    expect(pre).toBeDefined();
    expect(pre!.daysToPeak).toBeGreaterThan(0); // peak is ahead
    expect(pre!.intensityPct).toBeLessThan(100);
    expect(pre!.isPeakTonight).toBe(false);
  });
  it('returns nothing in a quiet stretch (mid-June)', () => {
    expect(meteorShowers('2024-06-15')).toEqual([]);
  });
  it('handles the year-boundary Quadrantids (active Dec 28 → Jan 12)', () => {
    const jan = meteorShowers('2024-01-03').find((s) => s.name === 'Quadrantids');
    expect(jan?.isPeakTonight).toBe(true);
    const dec = meteorShowers('2023-12-30').find((s) => s.name === 'Quadrantids');
    expect(dec).toBeDefined();
    expect(dec!.daysToPeak).toBeGreaterThan(0); // Jan 3 peak is a few days ahead
  });
  it('sorts strongest-first and is deterministic', () => {
    const a = meteorShowers('2024-07-30');
    const b = meteorShowers('2024-07-30');
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i - 1].intensityPct).toBeGreaterThanOrEqual(a[i].intensityPct);
  });
});

describe('meteorShowers — beyond basics', () => {
  it('surfaces multiple simultaneously-active showers, strongest first', () => {
    // Late July: Delta Aquariids (peak Jul 30) AND Perseids (active from Jul 17) overlap.
    const showers = meteorShowers('2024-07-30');
    const names = showers.map((s) => s.name);
    expect(names).toContain('Delta Aquariids');
    expect(names).toContain('Perseids');
    // Delta Aquariids is at peak (intensity 100) and should outrank the still-ramping Perseids.
    expect(showers[0].name).toBe('Delta Aquariids');
    expect(showers[0].intensityPct).toBeGreaterThanOrEqual(showers[1].intensityPct);
  });
  it('excludes a shower one day past its active window', () => {
    // Lyrids active Apr 16–25; Apr 27 is outside.
    expect(meteorShowers('2024-04-27').some((s) => s.name === 'Lyrids')).toBe(false);
  });
  it('Geminids hit ZHR 150 at peak', () => {
    const g = meteorShowers('2024-12-14').find((s) => s.name === 'Geminids');
    expect(g?.zhr).toBe(150);
    expect(g?.intensityPct).toBe(100);
  });
});

describe('satellitePasses (ADR-055)', () => {
  // Propagate the canonical ISS fixture NEAR its epoch (2008-09-20) so SGP4 stays valid.
  const NEAR_EPOCH = '2008-09-21';

  it('finds ISS passes over the Grand Canyon and shapes them well', () => {
    const passes = satellitePasses(GC.lat, GC.lng, [SAMPLE_ISS_TLE], NEAR_EPOCH, { stepSec: 20 });
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.name).toMatch(/ISS/);
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10); // default threshold
      expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
      expect(p.startAzimuthDeg).toBeGreaterThanOrEqual(0);
      expect(p.startAzimuthDeg).toBeLessThan(360);
      expect(p.durationMin).toBeGreaterThan(0);
      expect(typeof p.visible).toBe('boolean');
      expect(Date.parse(p.start)).toBeLessThanOrEqual(Date.parse(p.peak));
      expect(Date.parse(p.peak)).toBeLessThanOrEqual(Date.parse(p.end));
    }
    // sorted chronologically
    for (let i = 1; i < passes.length; i++) {
      expect(Date.parse(passes[i - 1].start)).toBeLessThanOrEqual(Date.parse(passes[i].start));
    }
  });
  it('respects a higher elevation threshold (fewer/again-no taller passes)', () => {
    const low = satellitePasses(GC.lat, GC.lng, [SAMPLE_ISS_TLE], NEAR_EPOCH, { stepSec: 20, minElevationDeg: 10 });
    const high = satellitePasses(GC.lat, GC.lng, [SAMPLE_ISS_TLE], NEAR_EPOCH, { stepSec: 20, minElevationDeg: 40 });
    expect(high.length).toBeLessThanOrEqual(low.length);
    for (const p of high) expect(p.maxElevationDeg).toBeGreaterThanOrEqual(40);
  });
  it('returns [] for no TLEs (graceful when CelesTrak is down)', () => {
    expect(satellitePasses(GC.lat, GC.lng, [], NEAR_EPOCH)).toEqual([]);
  });
  it('visibleOnly returns a subset of all passes (dark + sunlit gate)', () => {
    const all = satellitePasses(GC.lat, GC.lng, [SAMPLE_ISS_TLE], NEAR_EPOCH, { stepSec: 20 });
    const visible = satellitePasses(GC.lat, GC.lng, [SAMPLE_ISS_TLE], NEAR_EPOCH, { stepSec: 20, visibleOnly: true });
    expect(visible.length).toBeLessThanOrEqual(all.length);
    expect(visible.every((p) => p.visible)).toBe(true);
  });
  it('handles multiple satellites and stays chronologically sorted + deterministic', () => {
    const tles = [SAMPLE_ISS_TLE, { ...SAMPLE_ISS_TLE, name: 'ISS (CLONE)' }];
    const a = satellitePasses(GC.lat, GC.lng, tles, NEAR_EPOCH, { stepSec: 30 });
    const b = satellitePasses(GC.lat, GC.lng, tles, NEAR_EPOCH, { stepSec: 30 });
    expect(a).toEqual(b); // deterministic
    expect(a.some((p) => p.name === 'ISS (CLONE)')).toBe(true);
    for (let i = 1; i < a.length; i++) expect(Date.parse(a[i - 1].start)).toBeLessThanOrEqual(Date.parse(a[i].start));
  });
});

describe('parseTle', () => {
  it('parses 3-line CelesTrak records and tolerates CRLF + blanks', () => {
    const text = `ISS (ZARYA)\r\n${SAMPLE_ISS_TLE.line1}\r\n${SAMPLE_ISS_TLE.line2}\r\n\r\n`;
    const tles = parseTle(text);
    expect(tles).toHaveLength(1);
    expect(tles[0].name).toBe('ISS (ZARYA)');
    expect(tles[0].line1.startsWith('1 ')).toBe(true);
    expect(tles[0].line2.startsWith('2 ')).toBe(true);
  });
});

describe('shotPlan (ADR-055)', () => {
  it('aligns the Milky-Way core over a SE foreground in core season', () => {
    // Core rises ~SE at the Grand Canyon; aim a foreground bearing near its rise azimuth.
    const a = getAstro(GC.lat, GC.lng, '2024-06-21');
    const fg = a.galacticCore.riseAzimuthDeg ?? 130;
    const plan = shotPlan(GC.lat, GC.lng, fg, '2024-06-21');
    expect(plan.coreVisible).toBe(true);
    expect(plan.bestAlignment).not.toBeNull();
    expect(plan.bestAlignment!.altitudeDeg).toBeGreaterThan(0);
    expect(plan.aligned).toBe(true); // foreground == rise azimuth → within tolerance
    expect(plan.advice).toBeTruthy();
    expect(plan.window.hours).not.toBeNull();
  });
  it('classifies moon interference from illumination', () => {
    const newMoon = shotPlan(GC.lat, GC.lng, 150, '2024-04-08'); // ~new moon
    expect(['none', 'low']).toContain(newMoon.moonInterference);
    const fullMoon = shotPlan(GC.lat, GC.lng, 150, '2024-04-23'); // ~full moon
    expect(fullMoon.moonInterference).toBe('high');
  });
  it('is deterministic', () => {
    expect(shotPlan(GC.lat, GC.lng, 150, '2024-06-21')).toEqual(shotPlan(GC.lat, GC.lng, 150, '2024-06-21'));
  });
  it('reports no alignment under the midnight sun (no astronomical darkness)', () => {
    const plan = shotPlan(70, 20, 150, '2024-06-21'); // 70°N at solstice → never dark
    expect(plan.coreVisible).toBe(false);
    expect(plan.bestAlignment).toBeNull();
    expect(plan.window.hours).toBeNull();
    expect(plan.advice).toMatch(/No astronomical darkness/i);
  });
  it('normalizes the foreground bearing into 0–360', () => {
    const plan = shotPlan(GC.lat, GC.lng, 380, '2024-06-21'); // 380 → 20
    expect(plan.foregroundAzimuthDeg).toBe(20);
  });
});

describe('parseTle — beyond basics', () => {
  it('parses multiple records and skips junk/garbage lines', () => {
    const text = [
      '# a comment / header junk',
      SAMPLE_ISS_TLE.name,
      SAMPLE_ISS_TLE.line1,
      SAMPLE_ISS_TLE.line2,
      'TIANGONG',
      SAMPLE_ISS_TLE.line1.replace('25544', '48274'),
      SAMPLE_ISS_TLE.line2.replace('25544', '48274'),
    ].join('\n');
    const tles = parseTle(text);
    expect(tles.length).toBe(2);
    expect(tles[1].name).toBe('TIANGONG');
    expect(tles.every((t) => t.line1.startsWith('1 ') && t.line2.startsWith('2 '))).toBe(true);
  });
  it('returns [] for empty/garbage input', () => {
    expect(parseTle('')).toEqual([]);
    expect(parseTle('just some text\nwith no tle lines')).toEqual([]);
  });
});
