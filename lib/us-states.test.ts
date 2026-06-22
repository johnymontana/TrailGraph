import { describe, it, expect } from 'vitest';
import { stateName, STATE_NAMES, regionStates } from './us-states';

describe('regionStates (R4 §2.3 — region → state codes for intent search)', () => {
  it('resolves known regions (case-insensitive)', () => {
    expect(regionStates('Pacific Northwest')).toEqual(['WA', 'OR', 'ID']);
    expect(regionStates('pnw')).toEqual(['WA', 'OR', 'ID']);
    expect(regionStates('Southwest')).toEqual(['AZ', 'UT', 'NM', 'NV']);
  });
  it('matches a region key contained in a longer phrase', () => {
    expect(regionStates('somewhere in the rockies')).toEqual(['CO', 'MT', 'WY', 'ID', 'UT']);
  });
  it('falls back to a state name → code', () => {
    expect(regionStates('Washington')).toEqual(['WA']);
  });
  it('returns [] for unknown/empty input', () => {
    expect(regionStates('atlantis')).toEqual([]);
    expect(regionStates('')).toEqual([]);
    expect(regionStates(null)).toEqual([]);
  });
});

describe('stateName', () => {
  it('maps known codes to names', () => {
    expect(stateName('MT')).toBe('Montana');
    expect(stateName('wy')).toBe('Wyoming'); // case-insensitive
    expect(stateName('DC')).toBe('District of Columbia');
  });
  it('falls back to the code for unknown values', () => {
    expect(stateName('XX')).toBe('XX');
  });
  it('covers the 50 states + DC + territories', () => {
    expect(Object.keys(STATE_NAMES).length).toBeGreaterThanOrEqual(56);
  });
});
