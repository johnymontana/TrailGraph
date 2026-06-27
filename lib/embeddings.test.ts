import { describe, it, expect } from 'vitest';
import {
  composeParkText,
  composeTrailText,
  composePlaceText,
  composePersonText,
  composeArticleText,
  contentHash,
  clampForEmbedding,
  MAX_EMBED_CHARS,
} from './embeddings';

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

describe('composePlaceText / composePersonText', () => {
  it('folds title, body, and tags; drops empties', () => {
    expect(
      composePlaceText({ title: 'Artist Point', bodyText: 'Iconic falls view.', tags: ['Scenery', 'Geology'] }),
    ).toBe('Artist Point\nIconic falls view.\nScenery, Geology');
    // no tags → no trailing blank line
    expect(composePersonText({ title: 'Ferdinand Hayden', bodyText: 'Geologist.' })).toBe('Ferdinand Hayden\nGeologist.');
  });

  it('returns empty string when nothing to embed (so the embed step skips it)', () => {
    expect(composePlaceText({})).toBe('');
  });
});

describe('composeArticleText', () => {
  it('joins title + description and drops empties', () => {
    expect(composeArticleText({ title: 'Geysers', description: 'How they work.' })).toBe('Geysers\nHow they work.');
    expect(composeArticleText({ title: 'Just a title' })).toBe('Just a title');
  });
  it('includes the full body for semantic search (F8)', () => {
    expect(composeArticleText({ title: 'Geysers', description: 'Blurb.', body: 'The caldera powers 10,000 features.' }))
      .toBe('Geysers\nBlurb.\nThe caldera powers 10,000 features.');
  });
});

describe('composeTrailText (ADR-072 vibe-search)', () => {
  it('folds name + park + stats + topics + activities + blurb, dropping empties', () => {
    const text = composeTrailText({
      name: 'Avalanche Lake Trail',
      parkName: 'Glacier National Park',
      difficulty: 'moderate',
      routeType: 'out-and-back',
      lengthMiles: 5.9,
      topics: ['Alpine Lakes', 'Waterfalls'],
      activities: ['Hiking'],
      blurb: 'A forested walk to a cirque lake.',
    });
    expect(text).toBe(
      'Avalanche Lake Trail\nGlacier National Park\n5.9 mi · moderate · out-and-back\nAlpine Lakes, Waterfalls\nHiking\nA forested walk to a cirque lake.',
    );
  });
  it('omits a stats line when no stats are present', () => {
    expect(composeTrailText({ name: 'X', topics: [], activities: [] })).toBe('X');
  });
});

describe('clampForEmbedding (8192-token input guard)', () => {
  it('truncates oversized text to the char cap and leaves short text untouched', () => {
    expect(clampForEmbedding('short').length).toBe(5);
    const big = 'x'.repeat(MAX_EMBED_CHARS + 5000);
    expect(clampForEmbedding(big).length).toBe(MAX_EMBED_CHARS);
  });

  it('is deterministic so content-hash gating stays stable', () => {
    const big = 'y'.repeat(MAX_EMBED_CHARS + 100);
    expect(clampForEmbedding(big)).toBe(clampForEmbedding(big));
  });
});

describe('contentHash', () => {
  it('is deterministic and content-sensitive', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});
