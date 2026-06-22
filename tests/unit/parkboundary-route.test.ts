import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
  process.env.NPS_API_KEY = 'test-key';
});

import { GET } from '../../app/api/parkboundary/[parkCode]/route';

const ctx = (parkCode: string) => ({ params: Promise.resolve({ parkCode }) });

describe('GET /api/parkboundary/[parkCode] (P1 cached boundary proxy)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects an invalid parkCode (400) without calling NPS', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(new Request('http://test'), ctx('not-a-code'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes through NPS GeoJSON for a valid parkCode', async () => {
    const geo = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} }],
    };
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, json: async () => geo }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(new Request('http://test'), ctx('yell'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(geo);
    // sends the API key header to the mapdata endpoint
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'X-Api-Key': 'test-key' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/mapdata/parkboundaries/yell');
  });

  it('degrades to an empty FeatureCollection (200) when NPS 404s for a park with no boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const res = await GET(new Request('http://test'), ctx('aaaa'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
