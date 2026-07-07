import { describe, it, expect } from 'vitest';
import { tripIdsFromParts } from './chat-trips';

const outputPart = (output: unknown, state = 'output-available') => ({ type: 'dynamic-tool', state, output });

describe('tripIdsFromParts', () => {
  it('extracts the trip id from a saved itinerary_preview', () => {
    const parts = [outputPart({ kind: 'itinerary_preview', data: { trip: { id: 't1', name: 'Utah Loop' } } })];
    expect(tripIdsFromParts(parts)).toEqual(['t1']);
  });

  it('extracts the trip id from a confirmed nested add (addedTo), any card kind', () => {
    const parts = [
      outputPart({ kind: 'trail_detail_card', data: { name: 'Storm Point', addedTo: { tripId: 't2', stopLabel: 'Yellowstone' } } }),
      outputPart({ kind: 'campground_card', data: { campground: {}, addedTo: { tripId: 't3', stopLabel: 'Zion' } } }),
    ];
    expect(tripIdsFromParts(parts)).toEqual(['t2', 't3']);
  });

  it('never announces a preview: pendingAdd carries a tripId but wrote nothing', () => {
    const parts = [
      outputPart({ kind: 'trail_detail_card', data: { name: 'Storm Point', pendingAdd: { tripId: 't2', stopId: 's1' } } }),
    ];
    expect(tripIdsFromParts(parts)).toEqual([]);
  });

  it('ignores draft itinerary_preview outputs without a trip id (propose_itinerary)', () => {
    const parts = [outputPart({ kind: 'itinerary_preview', data: { trip: { name: 'Draft' } } })];
    expect(tripIdsFromParts(parts)).toEqual([]);
  });

  it('ignores a read-only itinerary_preview (suggest_day_plan persists nothing)', () => {
    const parts = [outputPart({ kind: 'itinerary_preview', data: { readOnly: true, trip: { id: 't1' } } })];
    expect(tripIdsFromParts(parts)).toEqual([]);
  });

  it('ignores parts that are not completed dynamic-tool outputs', () => {
    const parts = [
      { type: 'text', text: 'Saved your trip t1!' },
      outputPart({ kind: 'itinerary_preview', data: { trip: { id: 't1' } } }, 'input-available'),
    ];
    expect(tripIdsFromParts(parts as never)).toEqual([]);
  });

  it('dedups ids within one message and rejects non-string ids', () => {
    const parts = [
      outputPart({ kind: 'itinerary_preview', data: { trip: { id: 't1' } } }),
      outputPart({ kind: 'itinerary_preview', data: { trip: { id: 't1' } } }),
      outputPart({ kind: 'trail_detail_card', data: { addedTo: { tripId: 42 } } }),
    ];
    expect(tripIdsFromParts(parts)).toEqual(['t1']);
  });
});
