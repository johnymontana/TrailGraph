import { describe, it, expect } from 'vitest';
import { decodeEntities } from './html-entities';

describe('decodeEntities', () => {
  it('decodes the double-encoded ampersand (the §2.1 bug)', () => {
    expect(decodeEntities('Four Corners Ancestral Puebloan &amp; Dark Skies')).toBe(
      'Four Corners Ancestral Puebloan & Dark Skies',
    );
  });

  it('decodes multiple and mixed named entities', () => {
    expect(decodeEntities('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;')).toBe('A & B <C> "D" \'E\'');
  });

  it('decodes numeric (decimal and hex) entities', () => {
    expect(decodeEntities('Mom&#39;s trip')).toBe("Mom's trip");
    expect(decodeEntities('Mom&#x27;s trip')).toBe("Mom's trip");
  });

  it('is idempotent / identity on entity-free text', () => {
    expect(decodeEntities('Utah Dark Skies & Easy Hikes')).toBe('Utah Dark Skies & Easy Hikes');
    expect(decodeEntities('plain name')).toBe('plain name');
    expect(decodeEntities('')).toBe('');
  });

  it('leaves unknown / malformed entities untouched', () => {
    expect(decodeEntities('a &bogus; b')).toBe('a &bogus; b');
    expect(decodeEntities('Q & A')).toBe('Q & A'); // bare ampersand, not an entity
  });

  it('decodes ONE level per pass (a once-escaped legacy row → clean text in one call)', () => {
    // Render-side decode (P2.2) fixes legacy rows stored as a single entity in one pass…
    expect(decodeEntities('Stars &amp; Skies')).toBe('Stars & Skies');
    // …but a DOUBLE-escaped value (`&amp;amp;`) only peels one layer per call (documents the contingency:
    // if `&amp;` still shows after a render-side decode, the stored value was double-escaped).
    expect(decodeEntities('Stars &amp;amp; Skies')).toBe('Stars &amp; Skies');
    // A second pass finishes it — so the decode is safe to apply repeatedly.
    expect(decodeEntities(decodeEntities('Stars &amp;amp; Skies'))).toBe('Stars & Skies');
  });
});
