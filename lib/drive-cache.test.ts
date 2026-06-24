import { describe, it, expect, vi, beforeEach } from 'vitest';

const readGraph = vi.fn();
const writeGraph = vi.fn();
const driveSegments = vi.fn();
vi.mock('./neo4j', () => ({
  readGraph: (...a: unknown[]) => readGraph(...a),
  writeGraph: (...a: unknown[]) => writeGraph(...a),
}));
vi.mock('./routing', () => ({ routing: { driveSegments: (...a: unknown[]) => driveSegments(...a) } }));

import { cachedDriveSegments } from './drive-cache';

const A = { latitude: 44.6, longitude: -110.5 };
const B = { latitude: 43.7, longitude: -110.7 };

beforeEach(() => {
  readGraph.mockReset();
  writeGraph.mockReset();
  driveSegments.mockReset();
});

describe('cachedDriveSegments (audit C7)', () => {
  it('serves a full cache hit without calling ORS', async () => {
    readGraph.mockResolvedValue([{ idx: 0, miles: 100, minutes: 120, source: 'ors' }]);
    const segs = await cachedDriveSegments([A, B]);
    expect(driveSegments).not.toHaveBeenCalled();
    expect(writeGraph).not.toHaveBeenCalled();
    expect(segs).toEqual([{ fromIndex: 0, toIndex: 1, miles: 100, minutes: 120, source: 'ors' }]);
  });

  it('calls ORS on a miss and caches the ORS-sourced legs', async () => {
    readGraph.mockResolvedValue([{ idx: 0, miles: null, minutes: null, source: null }]);
    driveSegments.mockResolvedValue([{ fromIndex: 0, toIndex: 1, miles: 90, minutes: 110, source: 'ors' }]);
    const segs = await cachedDriveSegments([A, B]);
    expect(driveSegments).toHaveBeenCalledTimes(1);
    expect(writeGraph).toHaveBeenCalledTimes(1);
    const [, params] = writeGraph.mock.calls[0] as [string, { legs: unknown[] }];
    expect(params.legs).toHaveLength(1);
    expect(segs[0].source).toBe('ors');
  });

  it('never caches a great-circle fallback leg (so it retries ORS next time)', async () => {
    readGraph.mockResolvedValue([{ idx: 0, miles: null, minutes: null, source: null }]);
    driveSegments.mockResolvedValue([{ fromIndex: 0, toIndex: 1, miles: 70, minutes: 95, source: 'great_circle' }]);
    await cachedDriveSegments([A, B]);
    expect(writeGraph).not.toHaveBeenCalled();
  });
});
