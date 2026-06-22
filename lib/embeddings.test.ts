import { describe, it, expect } from 'vitest';
import { composeParkText, contentHash } from './embeddings';

describe('composeParkText', () => {
  it('folds relationships into the embedding document and drops empties', () => {
    const text = composeParkText({
      fullName: 'Glacier National Park',
      designation: 'National Park',
      description: 'Alpine lakes and peaks.',
      activityNames: ['Hiking', 'Astronomy'],
      topicNames: ['Glaciers'],
      states: 'MT',
    });
    expect(text).toContain('Glacier National Park');
    expect(text).toContain('Hiking, Astronomy');
    expect(text).toContain('Glaciers');
    expect(text).toContain('MT');
  });

  it('omits missing fields without leaving blank lines', () => {
    const text = composeParkText({ fullName: 'X', description: 'Y' });
    expect(text).toBe('X\nY');
  });
});

describe('contentHash', () => {
  it('is deterministic and content-sensitive', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});
