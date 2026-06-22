import { describe, it, expect } from 'vitest';
import { cleanTags } from './people';

describe('cleanTags', () => {
  it('dedupes case-insensitively, keeping the first and title-casing', () => {
    expect(cleanTags('Jane Doe', ['Botany', 'botany', 'BOTANY'])).toEqual(['Botany']);
  });

  it('drops tags that echo the person title (exact or containing the full title)', () => {
    expect(cleanTags('Muir Woods', ['Muir Woods', 'muir woods national monument', 'botany'])).toEqual([
      'Botany',
    ]);
  });

  it('keeps short tags that are mere substrings of the title', () => {
    // "art" is a substring of "Bartram" but must survive.
    expect(cleanTags('William Bartram', ['art', 'naturalist'])).toEqual(['Art', 'Naturalist']);
  });

  it('trims, drops blanks, and normalizes whitespace', () => {
    expect(cleanTags('X', ['  conservation  ', '', '   '])).toEqual(['Conservation']);
  });

  it('handles null/empty tags', () => {
    expect(cleanTags('X', null)).toEqual([]);
    expect(cleanTags('X', undefined)).toEqual([]);
    expect(cleanTags('X', [])).toEqual([]);
  });
});
