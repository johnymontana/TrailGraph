import { describe, it, expect } from 'vitest';
import { nearestNeighborOrder } from './route-order';

describe('nearestNeighborOrder', () => {
  it('orders stops by nearest-neighbor from the first stop', () => {
    // A(0,0) → far C(0,10) given out of order; nearest from A is B(0,1) then C.
    const order = nearestNeighborOrder([
      { id: 'A', lat: 0, lng: 0 },
      { id: 'C', lat: 0, lng: 10 },
      { id: 'B', lat: 0, lng: 1 },
    ]);
    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('keeps ≤2 stops as-is and appends unlocated stops at the end', () => {
    expect(nearestNeighborOrder([{ id: 'X', lat: 1, lng: 1 }])).toEqual(['X']);
    const order = nearestNeighborOrder([
      { id: 'A', lat: 0, lng: 0 },
      { id: 'B', lat: 0, lng: 1 },
      { id: 'C', lat: 0, lng: 2 },
      { id: 'custom', lat: null, lng: null },
    ]);
    expect(order[order.length - 1]).toBe('custom');
  });
});
