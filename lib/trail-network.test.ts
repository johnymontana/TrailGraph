import { describe, it, expect } from 'vitest';
import { computeConnections } from './trail-network';

/**
 * Trail-network adjacency (ADR-072): two trails CONNECT when their endpoint coordinate keys intersect;
 * the edge carries the count of DISTINCT shared junctions (≥2 ⇒ closes a loop). Pure.
 */
describe('computeConnections', () => {
  it('connects two trails that share one junction', () => {
    const edges = computeConnections([
      { id: 'a', endpointKeys: ['x', 'y'] },
      { id: 'b', endpointKeys: ['y', 'z'] },
    ]);
    expect(edges).toEqual([{ from: 'a', to: 'b', junctions: 1 }]);
  });

  it('reports two junctions when trails meet at both ends (a loopable pair)', () => {
    const edges = computeConnections([
      { id: 'south-kaibab', endpointKeys: ['rim', 'river'] },
      { id: 'bright-angel', endpointKeys: ['rim', 'river'] },
    ]);
    expect(edges).toEqual([{ from: 'bright-angel', to: 'south-kaibab', junctions: 2 }]);
  });

  it('does not connect trails that share no endpoint', () => {
    expect(
      computeConnections([
        { id: 'a', endpointKeys: ['x', 'y'] },
        { id: 'b', endpointKeys: ['p', 'q'] },
      ]),
    ).toEqual([]);
  });

  it('orders each edge by id and never emits a self- or duplicate edge', () => {
    const edges = computeConnections([
      { id: 'zeta', endpointKeys: ['j'] },
      { id: 'alpha', endpointKeys: ['j'] },
    ]);
    expect(edges).toEqual([{ from: 'alpha', to: 'zeta', junctions: 1 }]); // sorted, single edge
  });

  it('counts a repeated shared key only once (distinct junctions)', () => {
    const edges = computeConnections([
      { id: 'a', endpointKeys: ['j', 'j', 'k'] },
      { id: 'b', endpointKeys: ['j', 'k'] },
    ]);
    expect(edges).toEqual([{ from: 'a', to: 'b', junctions: 2 }]); // j and k, not 3
  });

  it('skips a trail with no endpoints', () => {
    expect(
      computeConnections([
        { id: 'a', endpointKeys: [] },
        { id: 'b', endpointKeys: ['x'] },
      ]),
    ).toEqual([]);
  });
});
