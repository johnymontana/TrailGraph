import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.NPS_API_KEY = 'test-key';
});

import { getConditions } from './conditions';

const ok = (json: unknown) => ({ ok: true, json: async () => json });

describe('getConditions (on-demand webcams + roadevents adapter, P2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps webcams (string isStreaming, first image) and sorts road events worst-first', async () => {
    const fetchMock = vi.fn(async (...args: unknown[]) => {
      const url = String(args[0]);
      if (url.includes('webcams'))
        return ok({
          data: [
            { id: 'w1', title: 'Old Faithful', status: 'Active', isStreaming: 'true', url: 'http://cam', images: [{ url: 'http://img' }] },
            { id: 'w2', title: 'Lake', status: 'Inactive', isStreaming: false },
          ],
        });
      if (url.includes('roadevents'))
        return ok({
          data: [
            { id: 'r1', properties: { headline: 'Minor shoulder work', event_type: 'Workzone', severity: 'minor' } },
            { id: 'r2', title: 'Road closed by rockfall', type: 'Incident', severity: 'major closure' },
          ],
        });
      return ok({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const c = await getConditions('yell');
    expect(c.webcams).toHaveLength(2);
    expect(c.webcams[0]).toMatchObject({ id: 'w1', isStreaming: true, imageUrl: 'http://img', url: 'http://cam' });
    expect(c.webcams[1].isStreaming).toBe(false);
    // Major (rank 3) sorts before Minor (rank 1); reads both the `properties` and flat shapes.
    expect(c.roadEvents.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(c.roadEvents[0]).toMatchObject({ severity: 'Major', type: 'Incident', title: 'Road closed by rockfall' });
    expect(c.roadEvents[1]).toMatchObject({ severity: 'Minor', type: 'Workzone' });
    // sends the API key header
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'X-Api-Key': 'test-key' });
  });

  it('degrades to empty arrays when the API errors (uneven coverage)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await getConditions('yell')).toEqual({ webcams: [], roadEvents: [] });
  });

  it('tolerates a bare-array response shape (no data wrapper)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: unknown[]) => (String(args[0]).includes('webcams') ? ok([{ id: 'w', title: 'Cam', status: 'Active' }]) : ok([]))),
    );
    const c = await getConditions('grca');
    expect(c.webcams).toHaveLength(1);
    expect(c.webcams[0].title).toBe('Cam');
  });
});
