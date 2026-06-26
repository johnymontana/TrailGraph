import { describe, it, expect } from 'vitest';
import { extractParkCards } from './chat-parks';

const card = (parks: unknown[], state = 'output-available') => ({ type: 'dynamic-tool', state, output: { kind: 'park_card', data: { parks } } });

describe('extractParkCards', () => {
  it('pulls located parks out of park_card outputs', () => {
    const parts = [card([{ parkCode: 'yell', name: 'Yellowstone', lat: 44.6, lng: -110.5 }])];
    expect(extractParkCards(parts)).toEqual([{ parkCode: 'yell', name: 'Yellowstone', lat: 44.6, lng: -110.5 }]);
  });

  it('dedupes by parkCode across multiple cards', () => {
    const parts = [
      card([{ parkCode: 'yell', lat: 44.6, lng: -110.5 }]),
      card([{ parkCode: 'yell', lat: 44.6, lng: -110.5 }, { parkCode: 'grte', lat: 43.8, lng: -110.7 }]),
    ];
    expect(extractParkCards(parts).map((p) => p.parkCode)).toEqual(['yell', 'grte']);
  });

  it('drops parks without coordinates (can\'t plot them)', () => {
    const parts = [card([{ parkCode: 'abc', lat: null, lng: null }, { parkCode: 'def', lat: 1, lng: 2 }])];
    expect(extractParkCards(parts).map((p) => p.parkCode)).toEqual(['def']);
  });

  it('handles the legacy single-park `data.park` shape', () => {
    const parts = [{ type: 'dynamic-tool', state: 'output-available', output: { kind: 'park_card', data: { park: { parkCode: 'zion', lat: 37.3, lng: -113 } } } }];
    expect(extractParkCards(parts).map((p) => p.parkCode)).toEqual(['zion']);
  });

  it('ignores non-park_card outputs + not-yet-complete parts', () => {
    const parts = [
      { type: 'dynamic-tool', state: 'input-available', output: undefined },
      { type: 'text', text: 'hello' },
      { type: 'dynamic-tool', state: 'output-available', output: { kind: 'weather_card', data: {} } },
      card([{ parkCode: 'acad', lat: 44.3, lng: -68.2 }], 'input-streaming'),
    ];
    expect(extractParkCards(parts as never)).toEqual([]);
  });
});
