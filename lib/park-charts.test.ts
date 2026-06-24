import { describe, it, expect } from 'vitest';
import {
  parkFingerprint,
  trailDifficultyBreakdown,
  trailScatterData,
  darkSkyGaugeData,
  weatherRangeData,
  crowdHeatmap,
} from './park-charts';

describe('parkFingerprint', () => {
  it('produces 6 axes all clamped to 0–100', () => {
    const fp = parkFingerprint({
      activities: ['Hiking', 'Boating', 'Birdwatching', 'Arts and Culture'],
      topics: ['Lakes', 'Wildlife'],
      thingsToDo: Array(12).fill({ difficulty: 'easy' }),
      bortleScale: 2,
      crowdLevel: 'low',
    });
    expect(fp).toHaveLength(6);
    expect(fp.map((a) => a.axis)).toEqual(['Trails', 'Dark sky', 'Solitude', 'Water', 'Wildlife', 'History & culture']);
    for (const a of fp) expect(a.value).toBeGreaterThanOrEqual(0), expect(a.value).toBeLessThanOrEqual(100);
  });
  it('maps dark sky (lower Bortle = higher) and solitude (lower crowd = higher)', () => {
    const dark = parkFingerprint({ bortleScale: 1, crowdLevel: 'low' });
    expect(dark.find((a) => a.axis === 'Dark sky')!.value).toBe(100);
    expect(dark.find((a) => a.axis === 'Solitude')!.value).toBeGreaterThan(80);
    const bright = parkFingerprint({ bortleScale: 9, crowdLevel: 'very high' });
    expect(bright.find((a) => a.axis === 'Dark sky')!.value).toBe(0);
    expect(bright.find((a) => a.axis === 'Solitude')!.value).toBeLessThan(20);
  });
  it('defaults gracefully with no data (dark sky 0, solitude neutral)', () => {
    const fp = parkFingerprint({});
    expect(fp.find((a) => a.axis === 'Dark sky')!.value).toBe(0);
    expect(fp.find((a) => a.axis === 'Solitude')!.value).toBe(50);
    expect(fp.find((a) => a.axis === 'Water')!.value).toBe(0);
  });
});

describe('trailDifficultyBreakdown', () => {
  it('counts by normalized difficulty and drops empty buckets', () => {
    const slices = trailDifficultyBreakdown([
      { difficulty: 'Easy' },
      { difficulty: 'easy walk' },
      { difficulty: 'Moderate' },
      { difficulty: 'Strenuous' },
      { difficulty: 'difficult' },
      { difficulty: null },
    ]);
    const byKey = Object.fromEntries(slices.map((s) => [s.difficulty, s.count]));
    expect(byKey.easy).toBe(2);
    expect(byKey.moderate).toBe(1);
    expect(byKey.strenuous).toBe(2); // "difficult" → strenuous
    expect(byKey.unknown).toBe(1);
  });
  it('returns [] when there are no trails', () => {
    expect(trailDifficultyBreakdown([])).toEqual([]);
    expect(trailDifficultyBreakdown(undefined)).toEqual([]);
  });
});

describe('trailScatterData', () => {
  it('keeps only trails with both length + elevation and rounds them', () => {
    const pts = trailScatterData([
      { title: 'A', length: 5.23, elevationGain: 1200.7, difficulty: 'moderate' },
      { title: 'B', length: null, elevationGain: 800 }, // dropped (no length)
      { title: 'C', length: 3, elevationGain: null }, // dropped (no elevation)
      { title: 'D', length: 0, elevationGain: 100 }, // dropped (length 0)
    ]);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({ title: 'A', length: 5.2, elevationGain: 1201, difficulty: 'moderate' });
  });
});

describe('darkSkyGaugeData', () => {
  it('returns null without a Bortle value', () => {
    expect(darkSkyGaugeData(null)).toBeNull();
    expect(darkSkyGaugeData(undefined)).toBeNull();
  });
  it('darker sky → fuller gauge + higher SQM', () => {
    const dark = darkSkyGaugeData(2)!;
    const bright = darkSkyGaugeData(8)!;
    expect(dark.fillPct).toBeGreaterThan(bright.fillPct);
    expect(dark.sqm).toBeGreaterThan(bright.sqm);
    expect(dark.stars).toBeGreaterThanOrEqual(4);
    expect(dark.label).toMatch(/dark/i);
  });
  it('clamps out-of-range Bortle', () => {
    expect(darkSkyGaugeData(0)!.fillPct).toBe(100); // clamps to 1
    expect(darkSkyGaugeData(99)!.fillPct).toBe(0); // clamps to 9
  });
});

describe('weatherRangeData', () => {
  it('maps a forecast to weekday hi/lo points', () => {
    const pts = weatherRangeData([
      { date: '2026-06-22', hiF: 71.6, loF: 43.2, condition: 'Clear', emoji: '☀️' },
      { date: '2026-06-23', hiF: 68, loF: 45, condition: 'Cloudy', emoji: '☁️' },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ hi: 72, lo: 43 });
    expect(typeof pts[0].day).toBe('string');
  });
  it('handles an empty/absent forecast', () => {
    expect(weatherRangeData([])).toEqual([]);
    expect(weatherRangeData(undefined)).toEqual([]);
  });
});

describe('crowdHeatmap', () => {
  it('returns 12 cells with intensity + best (lowest-crowd) flags', () => {
    const monthly = [10, 20, 30, 40, 50, 60, 100, 90, 80, 70, 25, 15].map((v) => v * 1000);
    const cells = crowdHeatmap(monthly);
    expect(cells).toHaveLength(12);
    expect(cells[6]).toMatchObject({ month: 'Jul', pct: 100 }); // busiest
    expect(cells[0].best).toBe(true); // January is among the quietest
    expect(cells[6].best).toBe(false); // July is the busiest
    for (const c of cells) expect(c.pct).toBeGreaterThanOrEqual(0), expect(c.pct).toBeLessThanOrEqual(100);
  });
  it('returns [] unless given 12 months', () => {
    expect(crowdHeatmap([1, 2, 3])).toEqual([]);
    expect(crowdHeatmap(undefined)).toEqual([]);
  });
});
