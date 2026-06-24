import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));

import { createWatch, WATCH_CAP } from './watches';
import { readGraph, writeGraph } from './neo4j';

const mRead = vi.mocked(readGraph);
const mWrite = vi.mocked(writeGraph);

beforeEach(() => {
  mRead.mockReset();
  mWrite.mockReset();
});

describe('createWatch cap (audit C8)', () => {
  it('re-watching an existing (kind, refId) skips the count check and updates', async () => {
    mRead.mockResolvedValueOnce([{ id: 'w1' }] as never); // existing-watch lookup hits
    mWrite.mockResolvedValue([{ id: 'w1' }] as never);
    const res = await createWatch('u', 'park', 'grca', 'Grand Canyon');
    expect(res).toEqual({ id: 'w1' });
    expect(mRead).toHaveBeenCalledTimes(1); // no count query for a re-watch
    expect(mWrite).toHaveBeenCalledTimes(1);
  });

  it('creates a new watch when under the cap', async () => {
    mRead.mockResolvedValueOnce([] as never); // not existing
    mRead.mockResolvedValueOnce([{ total: 5 }] as never); // count < cap
    mWrite.mockResolvedValue([{ id: 'new-id' }] as never);
    const res = await createWatch('u', 'park', 'zion');
    expect(res).toEqual({ id: 'new-id' });
    expect(mWrite).toHaveBeenCalledTimes(1);
  });

  it('blocks a new watch at the cap and writes nothing', async () => {
    mRead.mockResolvedValueOnce([] as never); // not existing
    mRead.mockResolvedValueOnce([{ total: WATCH_CAP }] as never); // at cap
    const res = await createWatch('u', 'park', 'zion');
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toContain(String(WATCH_CAP));
    expect(mWrite).not.toHaveBeenCalled();
  });
});
