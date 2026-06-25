import { describe, it, expect } from 'vitest';
import { parseJsonObject } from './generate';

describe('parseJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(parseJsonObject<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    const text = 'Here you go:\n```json\n{"modules":[]}\n```\n';
    expect(parseJsonObject<{ modules: unknown[] }>(text)).toEqual({ modules: [] });
  });

  it('strips bare ``` fences', () => {
    expect(parseJsonObject<{ ok: boolean }>('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('extracts the object from surrounding prose', () => {
    const text = 'Sure! {"x":"y"} hope that helps';
    expect(parseJsonObject<{ x: string }>(text)).toEqual({ x: 'y' });
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseJsonObject('no json here')).toThrow(/no JSON object/);
  });
});
