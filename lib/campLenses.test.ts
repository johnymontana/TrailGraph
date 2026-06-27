import { describe, it, expect } from 'vitest';
import { campLensColorExpr, campLensLegend, CAMP_LENSES } from './campLenses';

describe('campLensColorExpr', () => {
  it("returns null for 'none' (caller keeps the agency color)", () => {
    expect(campLensColorExpr('none', 'light')).toBeNull();
  });
  it('emits a case expression over the matching boolean prop', () => {
    expect(campLensColorExpr('free', 'light')).toEqual(['case', ['get', 'free'], expect.any(String), expect.any(String)]);
    expect(campLensColorExpr('hookups', 'light')?.[1]).toEqual(['get', 'hasHookups']);
    expect(campLensColorExpr('dispersed', 'light')?.[1]).toEqual(['get', 'dispersed']);
    expect(campLensColorExpr('ada', 'light')?.[1]).toEqual(['get', 'ada']);
    expect(campLensColorExpr('fcfs', 'light')?.[1]).toEqual(['get', 'fcfs']);
  });
  it('resolves different hex per color mode', () => {
    const light = campLensColorExpr('free', 'light') as unknown[];
    const dark = campLensColorExpr('free', 'dark') as unknown[];
    expect(light[2]).not.toBe(dark[2]);
  });
});

describe('campLensLegend', () => {
  it('empty for none, two-entry on/off otherwise', () => {
    expect(campLensLegend('none', 'light')).toEqual([]);
    const leg = campLensLegend('dispersed', 'light');
    expect(leg).toHaveLength(2);
    expect(leg[0].label).toBe('Dispersed');
  });
});

describe('CAMP_LENSES', () => {
  it('offers the agency default + 5 facet lenses', () => {
    expect(CAMP_LENSES.map((l) => l.key)).toEqual(['none', 'free', 'dispersed', 'hookups', 'ada', 'fcfs']);
  });
});
