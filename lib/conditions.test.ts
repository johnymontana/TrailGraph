import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the I/O boundaries so the pure aggregation logic is testable (CLAUDE.md unit convention).
vi.mock('./queries', () => ({ parkDetail: vi.fn() }));
vi.mock('./datasources', async () => {
  return {
    darkSkyRating: (b: number) => ({ stars: b <= 2 ? 5 : 3, label: b <= 2 ? 'Excellent dark skies' : 'Dark skies' }),
    getWeather: vi.fn(),
    monthNames: (m: number[]) => m.map((i) => ['Jan', 'Feb', 'Mar'][i] ?? String(i)).join(', '),
  };
});

import { tempBand, tempBandLabel, buildParkConditions } from './conditions';
import { parkDetail } from './queries';
import { getWeather } from './datasources';

describe('tempBand', () => {
  it('buckets daytime highs and handles null', () => {
    expect(tempBand(null)).toBeNull();
    expect(tempBand(10)).toBe('cold');
    expect(tempBand(31)).toBe('cold');
    expect(tempBand(32)).toBe('cool');
    expect(tempBand(49)).toBe('cool');
    expect(tempBand(50)).toBe('mild');
    expect(tempBand(69)).toBe('mild');
    expect(tempBand(70)).toBe('warm');
    expect(tempBand(84)).toBe('warm');
    expect(tempBand(85)).toBe('hot');
  });
  it('labels every band and null', () => {
    expect(tempBandLabel(null)).toBeNull();
    expect(tempBandLabel('cold')).toMatch(/32/);
    expect(tempBandLabel('hot')).toMatch(/85/);
  });
});

describe('buildParkConditions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when the park does not exist', async () => {
    vi.mocked(parkDetail).mockResolvedValue(null as never);
    expect(await buildParkConditions('nope')).toBeNull();
  });

  it('assembles dark-sky rating, crowd, best months, weather and temp band', async () => {
    vi.mocked(parkDetail).mockResolvedValue({
      name: 'Grand Canyon',
      lat: 36.1,
      lng: -112.1,
      bortleScale: 2,
      darkSkyCertified: true,
      crowdLevel: 'moderate',
      bestMonths: [0, 1],
    } as never);
    vi.mocked(getWeather).mockResolvedValue({
      currentTempF: 41,
      condition: 'Clear',
      emoji: '☀️',
      daily: [{ date: '2026-02-01', hiF: 48, loF: 22, condition: 'Clear', emoji: '☀️' }],
    } as never);

    const c = await buildParkConditions('grca', 0);
    expect(c).not.toBeNull();
    expect(c!.darkSky?.rating?.stars).toBe(5);
    expect(c!.darkSky?.bortleScale).toBe(2);
    expect(c!.crowdLevel).toBe('moderate');
    expect(c!.bestMonths).toBe('Jan, Feb');
    expect(c!.weather?.hi).toBe(48);
    expect(c!.tempBand).toBe('cool'); // hi 48 → cool
    expect(c!.order).toBe(0);
  });

  it('degrades gracefully with no dark-sky data and no weather', async () => {
    vi.mocked(parkDetail).mockResolvedValue({
      name: 'Somewhere',
      lat: null,
      lng: null,
      bortleScale: null,
      darkSkyCertified: false,
      crowdLevel: null,
      bestMonths: [],
    } as never);
    const c = await buildParkConditions('some');
    expect(c!.darkSky).toBeNull();
    expect(c!.weather).toBeNull();
    expect(c!.tempBand).toBeNull();
    expect(getWeather).not.toHaveBeenCalled(); // no coords → no fetch
  });
});
