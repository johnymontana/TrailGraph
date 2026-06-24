import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const writeGraph = vi.fn();
const getTrip = vi.fn();
vi.mock('./neo4j', () => ({ readGraph: (...a: unknown[]) => readGraph(...a), writeGraph: (...a: unknown[]) => writeGraph(...a) }));
vi.mock('./trips', () => ({ getTrip: (...a: unknown[]) => getTrip(...a) }));

import { createShareLink, getSharedTrip } from './share';

beforeEach(() => {
  readGraph.mockReset();
  writeGraph.mockReset();
  getTrip.mockReset();
});

describe('createShareLink (R4 — owner-scoped)', () => {
  it('returns null and writes nothing when the caller does not own the trip', async () => {
    readGraph.mockResolvedValue([]); // ownership check fails
    expect(await createShareLink('intruder', 't1', 'read')).toBeNull();
    expect(writeGraph).not.toHaveBeenCalled();
  });

  it('mints a hex token (no dashes) and persists a read-only ShareLink with a TTL when owned', async () => {
    readGraph.mockResolvedValue([{ ok: true }]);
    writeGraph.mockResolvedValue(undefined);
    const token = await createShareLink('owner', 't1'); // read-only only (S7: edit role removed)
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(writeGraph).toHaveBeenCalledTimes(1);
    const [cypher, params] = writeGraph.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ userId: 'owner', tripId: 't1', token, ttlDays: 30 });
    expect(cypher).toContain('expiresAt'); // S6: links expire
  });
});

describe('getSharedTrip (public token-scoped read)', () => {
  it('returns null for an unknown token', async () => {
    readGraph.mockResolvedValue([]);
    expect(await getSharedTrip('bogus')).toBeNull();
    expect(getTrip).not.toHaveBeenCalled();
  });

  it('resolves the token to its owner then loads that owner\'s trip', async () => {
    readGraph.mockResolvedValue([{ tripId: 't1', ownerId: 'owner', role: 'read' }]);
    getTrip.mockResolvedValue({ id: 't1', name: 'Loop', stops: [] });
    const res = await getSharedTrip('tok');
    expect(getTrip).toHaveBeenCalledWith('owner', 't1');
    expect(res).toEqual({ trip: { id: 't1', name: 'Loop', stops: [] }, role: 'read' });
  });

  it('returns null when the underlying trip is gone', async () => {
    readGraph.mockResolvedValue([{ tripId: 't1', ownerId: 'owner', role: 'read' }]);
    getTrip.mockResolvedValue(null);
    expect(await getSharedTrip('tok')).toBeNull();
  });
});
