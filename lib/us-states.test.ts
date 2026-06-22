import { describe, it, expect } from 'vitest';
import { stateName, STATE_NAMES } from './us-states';

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
