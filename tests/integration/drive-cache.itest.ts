import { it, expect, beforeEach, afterAll, vi } from 'vitest';
import { describeIntegration } from './db';
import { writeGraph, closeDriver } from '../../lib/neo4j';

// Mock ONLY the ORS gateway; the :DriveLeg cache itself runs against real Neo4j. This proves a cache
// hit serves without re-calling ORS (audit C7) and that great-circle legs are never cached.
vi.mock('../../lib/routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/routing')>();
  return { ...actual, routing: { driveSegments: vi.fn() } };
});

import { cachedDriveSegments } from '../../lib/drive-cache';
import { routing } from '../../lib/routing';

const ds = vi.mocked(routing.driveSegments);
const A = { latitude: 40.1234, longitude: -111.1234 };
const B = { latitude: 41.5678, longitude: -112.5678 };

describeIntegration('drive-leg cache (Neo4j)', () => {
  const cleanup = () =>
    writeGraph(`MATCH (l:DriveLeg) WHERE l.fromLat IN [40.1234, 41.5678] DETACH DELETE l`);

  beforeEach(async () => {
    ds.mockReset();
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await closeDriver();
  });

  it('misses then caches the ORS leg; the second identical call is a hit (no ORS)', async () => {
    ds.mockResolvedValue([{ fromIndex: 0, toIndex: 1, miles: 100, minutes: 120, source: 'ors' }]);
    const first = await cachedDriveSegments([A, B]);
    expect(ds).toHaveBeenCalledTimes(1);
    expect(first[0]).toMatchObject({ miles: 100, minutes: 120, source: 'ors' });

    const second = await cachedDriveSegments([A, B]);
    expect(ds).toHaveBeenCalledTimes(1); // still 1 — served from :DriveLeg
    expect(second[0]).toMatchObject({ miles: 100, minutes: 120, source: 'ors' });
  });

  it('never caches a great-circle fallback leg (retries ORS each time)', async () => {
    ds.mockResolvedValue([{ fromIndex: 0, toIndex: 1, miles: 70, minutes: 95, source: 'great_circle' }]);
    await cachedDriveSegments([A, B]);
    await cachedDriveSegments([A, B]);
    expect(ds).toHaveBeenCalledTimes(2);
  });
});
