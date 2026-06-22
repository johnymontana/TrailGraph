import { describe, it, expect } from 'vitest';
import { darkSkyRating } from './darksky';
import { deriveBestMonths, crowdLevel, monthNames } from './visitation';
import { classifyDifficulty, difficultyDot } from './trails';
import { recreationUrl, parseRidbId } from './recreation';
import { weatherCodeLabel } from './weather';
import { roadEventSeverity } from './conditions';

describe('darkSkyRating (§5a)', () => {
  it('maps Bortle to a 1–5 star rating (darker = more stars)', () => {
    expect(darkSkyRating(1)).toMatchObject({ stars: 5 });
    expect(darkSkyRating(3)).toMatchObject({ stars: 4 });
    expect(darkSkyRating(4)).toMatchObject({ stars: 3 });
    expect(darkSkyRating(6)).toMatchObject({ stars: 2 });
    expect(darkSkyRating(9)).toMatchObject({ stars: 1 });
  });
});

describe('visitation derivations (§5b)', () => {
  const peakSummer = [30, 35, 50, 110, 380, 760, 980, 920, 600, 250, 45, 30]; // Jan…Dec

  it('deriveBestMonths returns the lowest-crowd months (1-indexed, sorted)', () => {
    const best = deriveBestMonths(peakSummer);
    expect(best).toContain(1); // January is low
    expect(best).not.toContain(7); // July is the peak
    expect([...best]).toEqual([...best].sort((a, b) => a - b));
  });

  it('deriveBestMonths returns [] for a malformed array', () => {
    expect(deriveBestMonths([1, 2, 3])).toEqual([]);
  });

  it('crowdLevel buckets annual visits', () => {
    expect(crowdLevel(5_000_000)).toBe('very high');
    expect(crowdLevel(3_000_000)).toBe('high');
    expect(crowdLevel(1_000_000)).toBe('moderate');
    expect(crowdLevel(100_000)).toBe('low');
  });

  it('monthNames formats 1-indexed months', () => {
    expect(monthNames([1, 4, 11])).toBe('Jan, Apr, Nov');
    expect(monthNames([])).toBe('');
  });
});

describe('trail difficulty (§5c)', () => {
  it('classifies difficulty from free text, hardest signal wins', () => {
    expect(classifyDifficulty('A strenuous backcountry scramble')).toBe('strenuous');
    expect(classifyDifficulty('Moderate 4-mile loop')).toBe('moderate');
    expect(classifyDifficulty('Easy paved boardwalk, wheelchair accessible')).toBe('easy');
    expect(classifyDifficulty('A scenic overlook')).toBeNull();
  });

  it('maps difficulty to a colored dot', () => {
    expect(difficultyDot('easy')).toBe('🟢');
    expect(difficultyDot('moderate')).toBe('🟡');
    expect(difficultyDot('strenuous')).toBe('🔴');
    expect(difficultyDot(null)).toBe('⚪');
  });
});

describe('recreation.gov link (§5d)', () => {
  it('builds the public campground URL for a RIDB id', () => {
    expect(recreationUrl('232449')).toBe('https://www.recreation.gov/camping/campgrounds/232449');
  });

  it('parses the RIDB facility id out of NPS-provided recreation.gov URLs', () => {
    expect(parseRidbId('https://www.recreation.gov/camping/campgrounds/10182621')).toBe('10182621');
    expect(parseRidbId('https://www.recreation.gov/camping/campgrounds/233321?q=Adirondack')).toBe('233321');
    expect(parseRidbId('https://www.nps.gov/yell')).toBeNull(); // not a recreation.gov campground URL
    expect(parseRidbId('')).toBeNull();
    expect(parseRidbId(null)).toBeNull();
  });
});

describe('weatherCodeLabel (§4)', () => {
  it('maps WMO codes to a label + emoji', () => {
    expect(weatherCodeLabel(0).label).toBe('Clear');
    expect(weatherCodeLabel(3).label).toBe('Overcast');
    expect(weatherCodeLabel(61).label).toBe('Rain');
    expect(weatherCodeLabel(75).label).toBe('Snow');
    expect(weatherCodeLabel(95).label).toBe('Thunderstorm');
    expect(weatherCodeLabel(null).label).toBe('—');
  });
});

describe('roadEventSeverity (P2 conditions)', () => {
  it('ranks severities for sorting (major worst)', () => {
    expect(roadEventSeverity('Major delays')).toEqual({ label: 'Major', rank: 3 });
    expect(roadEventSeverity('road closed')).toEqual({ label: 'Major', rank: 3 });
    expect(roadEventSeverity('Moderate')).toEqual({ label: 'Moderate', rank: 2 });
    expect(roadEventSeverity('Minor')).toEqual({ label: 'Minor', rank: 1 });
    expect(roadEventSeverity('')).toEqual({ label: 'Info', rank: 0 });
    expect(roadEventSeverity(null)).toEqual({ label: 'Info', rank: 0 });
  });
});
