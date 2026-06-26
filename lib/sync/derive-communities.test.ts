import { describe, it, expect, vi, beforeEach } from 'vitest';

const writeGraph = vi.fn();
const gdsAvailable = vi.fn();
const projectThemes = vi.fn();
const dropProjection = vi.fn();
vi.mock('../neo4j', () => ({ writeGraph: (...a: unknown[]) => writeGraph(...a) }));
vi.mock('../graph-analytics', () => ({
  gdsAvailable: (...a: unknown[]) => gdsAvailable(...a),
  projectThemes: (...a: unknown[]) => projectThemes(...a),
  dropProjection: (...a: unknown[]) => dropProjection(...a),
  THEME_GRAPH: 'parks-themes',
}));

import { deriveCommunities } from './derive-communities';

beforeEach(() => {
  writeGraph.mockReset();
  gdsAvailable.mockReset();
  projectThemes.mockReset().mockResolvedValue(undefined);
  dropProjection.mockReset().mockResolvedValue(undefined);
});

describe('deriveCommunities', () => {
  it('no-ops cleanly (skipped) when GDS is unavailable — never touches the graph', async () => {
    gdsAvailable.mockResolvedValue(false);
    const r = await deriveCommunities();
    expect(r).toEqual({ communities: 0, named: 0, skipped: 1 });
    expect(writeGraph).not.toHaveBeenCalled();
    expect(projectThemes).not.toHaveBeenCalled();
  });

  it('cleans, projects, writes communities, materializes, and drops the projection', async () => {
    gdsAvailable.mockResolvedValue(true);
    writeGraph.mockResolvedValue([{ n: 7, c: 7 }]);
    const r = await deriveCommunities();
    expect(projectThemes).toHaveBeenCalledTimes(1);
    expect(dropProjection).toHaveBeenCalledWith('parks-themes'); // dropped in finally
    expect(r.communities).toBe(7);
    expect(r.named).toBe(7);
    // cleaned IN_COMMUNITY + :Community before rematerializing
    const cypher = writeGraph.mock.calls.map((c) => String(c[0]));
    expect(cypher.some((q) => /\[r:IN_COMMUNITY\]->\(\) DELETE r/.test(q))).toBe(true);
    expect(cypher.some((q) => /Community\) DETACH DELETE c/.test(q))).toBe(true);
  });

  it('falls back to Louvain when Leiden is unavailable', async () => {
    gdsAvailable.mockResolvedValue(true);
    let leidenTried = false;
    writeGraph.mockImplementation(async (q: string) => {
      if (/gds\.leiden\.write/.test(q)) {
        leidenTried = true;
        throw new Error('There is no procedure with the name gds.leiden.write');
      }
      return [{ n: 4, c: 4 }];
    });
    const r = await deriveCommunities();
    expect(leidenTried).toBe(true);
    const cypher = writeGraph.mock.calls.map((c) => String(c[0]));
    expect(cypher.some((q) => /gds\.louvain\.write/.test(q))).toBe(true);
    expect(r.communities).toBe(4);
  });
});
