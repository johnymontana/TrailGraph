import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeGraph = vi.fn();
vi.mock('../neo4j', () => ({ writeGraph: (...a: unknown[]) => writeGraph(...a) }));

import { deriveCoConsidered } from './derive-co-considered';

beforeEach(() => writeGraph.mockReset());

describe('deriveCoConsidered', () => {
  it('DELETE-then-MERGEs CO_CONSIDERED and clamps minUsers to the k-anonymity floor (≥5)', async () => {
    writeGraph.mockResolvedValue([{ edges: 4 }]);
    const r = await deriveCoConsidered(2); // below the floor → must clamp to 5
    expect(r.edges).toBe(4);
    const cypher = writeGraph.mock.calls.map((c) => String(c[0]));
    expect(cypher.some((q) => /\[r:CO_CONSIDERED\]->\(:Park\) DELETE r/.test(q))).toBe(true);
    const merge = writeGraph.mock.calls.find((c) => /MERGE \(a\)-\[r:CO_CONSIDERED\]/.test(String(c[0])));
    expect(merge).toBeDefined();
    expect((merge![1] as { minUsers: number }).minUsers).toBe(5);
  });

  it('honors a higher minUsers above the floor', async () => {
    writeGraph.mockResolvedValue([{ edges: 0 }]);
    await deriveCoConsidered(10);
    const merge = writeGraph.mock.calls.find((c) => /MERGE \(a\)-\[r:CO_CONSIDERED\]/.test(String(c[0])));
    expect((merge![1] as { minUsers: number }).minUsers).toBe(10);
  });
});
