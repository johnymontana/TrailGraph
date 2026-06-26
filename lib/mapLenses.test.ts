import { describe, it, expect } from 'vitest';
import { MAP_LENSES, lensColorExpr, lensLegend, lensLabel, type LensKey } from './mapLenses';

const DATA_LENSES: LensKey[] = ['darksky', 'crowd', 'fee', 'accessibility'];

describe('map lenses', () => {
  it('registry leads with the default designation lens', () => {
    expect(MAP_LENSES[0].key).toBe('none');
    expect(MAP_LENSES.map((l) => l.key)).toEqual(['none', 'darksky', 'crowd', 'fee', 'accessibility']);
  });

  it("'none' yields no recolor expression or legend (designation colors stay)", () => {
    expect(lensColorExpr('none', 'light')).toBeNull();
    expect(lensLegend('none', 'light')).toEqual([]);
  });

  it('every data lens returns a MapLibre expression + a non-empty legend', () => {
    for (const key of DATA_LENSES) {
      const expr = lensColorExpr(key, 'light');
      expect(Array.isArray(expr)).toBe(true);
      expect((expr as unknown[])[0]).toMatch(/^(step|match|case)$/);
      expect(lensLegend(key, 'light').length).toBeGreaterThan(0);
    }
  });

  it('dark-sky + crowd lenses include an explicit "No data" bucket (never imply worst-case)', () => {
    expect(lensLegend('darksky', 'light').some((e) => e.key === 'nodata')).toBe(true);
    expect(lensLegend('crowd', 'light').some((e) => e.key === 'nodata')).toBe(true);
    // dark-sky is a step over bortleScale with the base bucket = No data (for the baked -1 sentinel).
    const expr = lensColorExpr('darksky', 'light') as unknown[];
    expect(expr[0]).toBe('step');
    expect(expr[1]).toEqual(['get', 'bortleScale']);
    expect(expr[2]).toBe(lensLegend('darksky', 'light').find((e) => e.key === 'nodata')!.color); // base = No data
    expect(expr[3]).toBe(1); // first Bortle threshold
  });

  it('crowd lens maps each enum value and defaults unknown → No data', () => {
    const expr = lensColorExpr('crowd', 'light') as unknown[];
    expect(expr[0]).toBe('match');
    expect(expr).toContain('low');
    expect(expr).toContain('very high');
    // match default (last element) is the No-data color.
    expect(expr[expr.length - 1]).toBe(lensLegend('crowd', 'light').find((e) => e.key === 'nodata')!.color);
  });

  it('boolean lenses use a two-color case', () => {
    expect((lensColorExpr('fee', 'light') as unknown[])[0]).toBe('case');
    expect((lensColorExpr('accessibility', 'light') as unknown[])[0]).toBe('case');
  });

  it('resolves distinct light/dark hex (theme parity)', () => {
    expect(lensColorExpr('crowd', 'light')).not.toEqual(lensColorExpr('crowd', 'dark'));
    expect(lensLegend('fee', 'light')[0].color).not.toBe(lensLegend('fee', 'dark')[0].color);
  });

  it('exposes labels', () => {
    expect(lensLabel('darksky')).toBe('Dark sky');
    expect(lensLabel('none')).toBe('Designation');
  });
});
