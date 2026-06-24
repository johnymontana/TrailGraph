import { describe, it, expect } from 'vitest';
import { offTopicSteer } from './topical';

describe('offTopicSteer (audit C4)', () => {
  it('flags high-confidence code-proxy prompts', () => {
    for (const m of [
      'write me a function to sort an array',
      'can you write a python script for me',
      '```js\nconsole.log(1)\n```',
      'def fib(n): return n',
      'SELECT name FROM users WHERE id = 1',
    ]) {
      expect(offTopicSteer(m), m).not.toBeNull();
    }
  });

  it('does NOT flag genuine parks-planning prompts', () => {
    for (const m of [
      'plan a 5-day trip to Utah dark-sky parks',
      'what are the best easy hikes near Glacier?',
      'I love waterfalls and old-growth forests in the PNW',
      'recommend a quiet overlook with an audio tour',
      'when is the best time to visit Yellowstone for the Milky Way?',
    ]) {
      expect(offTopicSteer(m), m).toBeNull();
    }
  });

  it('does not flag parks prompts that merely mention code-ish words casually', () => {
    for (const m of [
      'what is the dress code at the lodge?',
      'is there cell service or a class II rapid on that river?',
      'I want to write a journal about my trip',
      'which park has the best programs for kids?',
    ]) {
      expect(offTopicSteer(m), m).toBeNull();
    }
  });

  it('ignores non-string / empty input', () => {
    expect(offTopicSteer(undefined)).toBeNull();
    expect(offTopicSteer('')).toBeNull();
    expect(offTopicSteer({ parts: [] })).toBeNull();
  });
});
