import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describeIntegration } from './db';
import { readGraph, writeGraph, closeDriver } from '../../lib/neo4j';
import { deriveTrailElevation } from '../../lib/sync/derive-trail-elevation';

/**
 * derive-trail-elevation against a REAL Neo4j (ADR-068). Exercises the full pipeline the unit test mocks:
 * the parks read query, the local-fs Blob read (`readParkTrails`), the per-segment sample → profile → grade,
 * and the real `SET t.elevation*`/difficulty WRITE. Isolated to a dedicated `eltest` park (the seed sets no
 * `trailsGeoUrl`, so deriveTrailElevation otherwise no-ops). The elevation API is stubbed via global fetch;
 * the Blob token is unset so `putParkTrails` writes to `public/trails/` (cleaned up). RUN_INTEGRATION-gated.
 */
const PARK = 'eltest';
const TRAIL = 'nps:eltest:t1';
const FILE = join(process.cwd(), 'public', 'trails', `${PARK}.geojson`);

const cleanFC = () =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: [[[-110, 44], [-110, 44.01]]] }, // ~1.1km
        properties: { id: TRAIL, name: 'Elev Test', parkCode: PARK, lengthMiles: 0.7, trailClass: 3 },
      },
    ],
  });

describeIntegration('derive-trail-elevation (Neo4j + local Blob + stubbed elevation API)', () => {
  let savedToken: string | undefined;

  beforeAll(async () => {
    savedToken = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN; // putParkTrails → local fs (never a real Blob network call)
    process.env.ELEVATION_API_URL = 'https://api.test/v1/ned10m';
    process.env.TRAIL_ELEV_THROTTLE_MS = '0'; // no real delays
    await mkdir(join(process.cwd(), 'public', 'trails'), { recursive: true });
    await writeGraph(
      `MERGE (p:Park {parkCode:$pc}) SET p.name='Elev Test NP', p.trailsGeoUrl=$url
       MERGE (t:Trail {id:$id}) SET t.parkCode=$pc, t.name='Elev Test', t.lengthMiles=0.7
       MERGE (t)-[:IN_PARK]->(p)`,
      { pc: PARK, id: TRAIL, url: `/trails/${PARK}.geojson` },
    );
  });

  afterAll(async () => {
    await writeGraph(`MATCH (t:Trail {id:$id}) DETACH DELETE t`, { id: TRAIL });
    await writeGraph(`MATCH (p:Park {parkCode:$pc}) DETACH DELETE p`, { pc: PARK });
    await rm(FILE, { force: true });
    delete process.env.ELEVATION_API_URL;
    delete process.env.TRAIL_ELEV_THROTTLE_MS;
    if (savedToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = savedToken;
    vi.unstubAllGlobals();
    await closeDriver();
  });

  // Fresh, ungraded starting point: a clean Blob FC (no elevation props) + a graph trail with no scalars.
  const reset = async () => {
    await writeFile(FILE, cleanFC(), 'utf8');
    await writeGraph(
      `MATCH (t:Trail {id:$id}) REMOVE t.elevationGainFt, t.difficulty, t.estTimeHrs`,
      { id: TRAIL },
    );
  };

  it('grades a trail end-to-end: Blob geometry → sample → elevation + difficulty written to the graph', async () => {
    await reset();
    // Monotonic rise → real positive gain.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: Array.from({ length: 500 }, (_, i) => ({ elevation: 1000 + i * 10 })) }),
      })),
    );

    const r = await deriveTrailElevation();
    expect(r.graded).toBeGreaterThanOrEqual(1);
    expect(r.rateLimited).toBe(0);

    const [row] = await readGraph<{ g: number | null; d: string | null; est: number | null }>(
      `MATCH (t:Trail {id:$id}) RETURN t.elevationGainFt AS g, t.difficulty AS d, t.estTimeHrs AS est`,
      { id: TRAIL },
    );
    expect(row.g).toBeGreaterThan(0); // gain accumulated from the rising profile
    expect(row.d).toBeTruthy(); // difficulty graded (Shenandoah band)
    expect(row.est).toBeGreaterThan(0); // Naismith est-time
  });

  it('stops cleanly on HTTP 429 and leaves the trail UNGRADED (resumable next run)', async () => {
    await reset();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));

    const r = await deriveTrailElevation();
    expect(r.rateLimited).toBe(1);
    expect(r.graded).toBe(0);

    const [row] = await readGraph<{ g: number | null }>(
      `MATCH (t:Trail {id:$id}) RETURN t.elevationGainFt AS g`,
      { id: TRAIL },
    );
    expect(row.g).toBeNull(); // never graded on a partial profile → picked up again next run
  });
});
