import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.NPS_API_KEY = 'test-key';
});

import { fetchAll } from './nps';

function page(data: unknown[], total: number, start: number) {
  return {
    ok: true,
    json: async () => ({ total: String(total), limit: '50', start: String(start), data }),
  };
}

describe('fetchAll', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paginates until the total is exhausted and aggregates results', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` }));
    const second = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(first, 70, 0))
      .mockResolvedValueOnce(page(second, 70, 50));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchAll('parks');
    expect(all).toHaveLength(70);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // sends the API key header and zero-based start
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain('start=0');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'X-Api-Key': 'test-key' });
  });

  it('retries on 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce(page([{ id: 'x' }], 1, 0));
    vi.stubGlobal('fetch', fetchMock);

    const all = await fetchAll('alerts');
    expect(all).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
