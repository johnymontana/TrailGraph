import { describe, it, expect } from 'vitest';
import { normalizeCampName, nameSimilar } from './resolve-campgrounds';

describe('normalizeCampName', () => {
  it('lowercases, strips punctuation, drops camp/area stopwords', () => {
    expect(normalizeCampName('Upper Pines Campground')).toEqual(['upper', 'pines']);
    expect(normalizeCampName('Canyon CG (RV Area)')).toEqual(['canyon']);
    expect(normalizeCampName('Campground')).toEqual([]); // all stopwords
  });
});

describe('nameSimilar', () => {
  it('matches the same campground named slightly differently', () => {
    expect(nameSimilar('Upper Pines Campground', 'Upper Pines')).toBe(true);
    expect(nameSimilar('Canyon Campground', 'Canyon CG')).toBe(true);
    expect(nameSimilar('Gallatin Dispersed Area', 'Gallatin Dispersed')).toBe(true);
  });
  it('does NOT match two real neighbours with different names', () => {
    expect(nameSimilar('Upper Pines', 'Lower Pines')).toBe(false); // {upper,pines} vs {lower,pines} = 1/3 < 0.5
    expect(nameSimilar('North Rim', 'Mather')).toBe(false);
  });
  it('is false when a name reduces to only stopwords', () => {
    expect(nameSimilar('Campground', 'Canyon Campground')).toBe(false);
  });
});
