import { describe, it, expect } from 'vitest';
import { scoreMapCondition, clearSkyFromCondition, conditionLegend, conditionMatchStops, conditionDefaultColor, type ConditionFacts } from './conditions-map';

const base: ConditionFacts = {
  open: 'open',
  alert: false,
  clearSky: null,
  moonIlluminationPct: null,
  crowdLevel: null,
  feeFree: false,
};

describe('scoreMapCondition', () => {
  it('hard-overrides a closed park or active alert to "closed" (score 0)', () => {
    expect(scoreMapCondition({ ...base, open: 'closed' })).toEqual({ score: 0, category: 'closed' });
    // An alert overrides even an otherwise-perfect day.
    expect(scoreMapCondition({ ...base, alert: true, clearSky: true, crowdLevel: 'low' }).category).toBe('closed');
  });

  it('returns "unknown" when there is essentially no signal (never guesses "good")', () => {
    expect(scoreMapCondition({ ...base, open: 'unknown' })).toEqual({ score: 0, category: 'unknown' });
  });

  it('scores a clear, quiet, open day as "good"', () => {
    const r = scoreMapCondition({ ...base, open: 'open', clearSky: true, crowdLevel: 'low' });
    expect(r.category).toBe('good');
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it('scores a cloudy, packed day as "poor"', () => {
    const r = scoreMapCondition({ ...base, clearSky: false, crowdLevel: 'very high' });
    expect(r.category).toBe('poor');
    expect(r.score).toBeLessThan(45);
  });

  it('treats null weather/crowd as neutral (not negative)', () => {
    // open + no other signal → mid-range "fair", not poor.
    expect(scoreMapCondition({ ...base, open: 'open' }).category).toBe('fair');
  });

  it('gives a new-moon dark-sky bonus and a full-moon penalty', () => {
    const dark = scoreMapCondition({ ...base, clearSky: true, moonIlluminationPct: 5 });
    const full = scoreMapCondition({ ...base, clearSky: true, moonIlluminationPct: 95 });
    expect(dark.score).toBeGreaterThan(full.score);
  });

  it('clamps to 0..100 and nudges for fee-free days', () => {
    const withFee = scoreMapCondition({ ...base, open: 'open', clearSky: true, crowdLevel: 'low', moonIlluminationPct: 5, feeFree: true });
    expect(withFee.score).toBeLessThanOrEqual(100);
    expect(withFee.score).toBeGreaterThanOrEqual(scoreMapCondition({ ...base, open: 'open', clearSky: true, crowdLevel: 'low', moonIlluminationPct: 5 }).score);
  });
});

describe('clearSkyFromCondition', () => {
  it('maps clear/partly to true, cloudy/rain to false, missing to null', () => {
    expect(clearSkyFromCondition('Clear')).toBe(true);
    expect(clearSkyFromCondition('Partly cloudy')).toBe(true);
    expect(clearSkyFromCondition('Overcast')).toBe(false);
    expect(clearSkyFromCondition('Rain')).toBe(false);
    expect(clearSkyFromCondition(null)).toBeNull();
    expect(clearSkyFromCondition(undefined)).toBeNull();
  });
});

describe('condition colors + legend', () => {
  it('legend covers all 5 categories with light/dark parity', () => {
    expect(conditionLegend('light')).toHaveLength(5);
    expect(conditionLegend('light')).not.toEqual(conditionLegend('dark'));
  });
  it('match stops exclude the default (unknown) bucket and pair value→color', () => {
    const stops = conditionMatchStops('light');
    expect(stops).not.toContain('unknown');
    expect(stops[0]).toBe('good');
    expect(stops.length).toBe(8); // 4 categories × 2
    expect(conditionDefaultColor('light')).toBe(conditionLegend('light').find((e) => e.key === 'unknown')!.color);
  });
});
