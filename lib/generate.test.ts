import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseJsonObject, generateText, generateJson } from './generate';

describe('parseJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(parseJsonObject<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    const text = 'Here you go:\n```json\n{"modules":[]}\n```\n';
    expect(parseJsonObject<{ modules: unknown[] }>(text)).toEqual({ modules: [] });
  });

  it('strips bare ``` fences', () => {
    expect(parseJsonObject<{ ok: boolean }>('```\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('extracts the object from surrounding prose', () => {
    const text = 'Sure! {"x":"y"} hope that helps';
    expect(parseJsonObject<{ x: string }>(text)).toEqual({ x: 'y' });
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseJsonObject('no json here')).toThrow(/no JSON object/);
  });

  it('keeps nested objects/arrays intact when spanning the outermost braces', () => {
    // first '{' at index 0, last '}' at the end → the whole valid object is captured,
    // including the nested object and the array (which has no trailing '}' after it).
    const text = '{"a":{"b":1},"c":[1,2]}';
    expect(parseJsonObject<{ a: { b: number }; c: number[] }>(text)).toEqual({
      a: { b: 1 },
      c: [1, 2],
    });
  });

  it('throws on prose with two separate objects (first-{ to last-} merges into invalid JSON)', () => {
    // Documents the single-object assumption: it slices from the FIRST '{' to the LAST '}',
    // producing `{"a":1} then {"b":2}` which is invalid → JSON.parse throws (no silent mis-parse).
    expect(() => parseJsonObject('first {"a":1} then {"b":2}')).toThrow();
  });
});

describe('generateText', () => {
  beforeEach(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-gw-key';
    delete process.env.AGENT_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.AGENT_MODEL;
  });

  function mockFetchOk(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      temperature: number;
      messages: { role: string; content: string }[];
    };
  }

  it('posts system+user messages with default model/max_tokens/temperature and returns content', async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: 'hi' } }] });

    const out = await generateText({ system: 'you are a ranger', prompt: 'hello' });
    expect(out).toBe('hi');

    // endpoint + auth header
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-gw-key');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    // body: defaults + the two messages
    const body = bodyOf(fetchMock);
    expect(body.model).toBe('anthropic/claude-sonnet-4-6');
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toEqual([
      { role: 'system', content: 'you are a ranger' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('lets explicit model/maxTokens/temperature override the defaults', async () => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: 'ok' } }] });

    await generateText({
      system: 's',
      prompt: 'p',
      model: 'anthropic/claude-opus-4-1',
      maxTokens: 256,
      temperature: 0,
    });

    const body = bodyOf(fetchMock);
    expect(body.model).toBe('anthropic/claude-opus-4-1');
    expect(body.max_tokens).toBe(256);
    expect(body.temperature).toBe(0);
  });

  it('throws with the status code on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'upstream boom',
      }),
    );
    await expect(generateText({ system: 's', prompt: 'p' })).rejects.toThrow(/AI Gateway chat 500/);
  });

  it('throws when AI_GATEWAY_API_KEY is not set (before any fetch)', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateText({ system: 's', prompt: 'p' })).rejects.toThrow(
      /AI_GATEWAY_API_KEY is not set/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns "" when the gateway omits choices or message content (no throw)', async () => {
    mockFetchOk({}); // no choices at all
    expect(await generateText({ system: 's', prompt: 'p' })).toBe('');

    mockFetchOk({ choices: [{}] }); // choice present but no message/content
    expect(await generateText({ system: 's', prompt: 'p' })).toBe('');
  });
});

describe('generateJson', () => {
  beforeEach(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-gw-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_GATEWAY_API_KEY;
  });

  it('appends the JSON-only instruction to system and parses a fenced object', async () => {
    const fenced = 'Here:\n```json\n{"title":"Intro","modules":[]}\n```';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: fenced } }] }),
      text: async () => fenced,
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateJson<{ title: string; modules: unknown[] }>({
      system: 'Build a course.',
      prompt: 'go',
    });
    expect(out).toEqual({ title: 'Intro', modules: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
    };
    const sys = body.messages.find((m) => m.role === 'system')!;
    expect(sys.content).toBe(
      'Build a course.\n\nRespond with a single JSON object and nothing else.',
    );
    expect(sys.content.endsWith('Respond with a single JSON object and nothing else.')).toBe(true);
  });

  it('throws when the model returns no JSON object', async () => {
    const chatty = 'I cannot help with that.';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: chatty } }] }),
        text: async () => chatty,
      }),
    );
    await expect(generateJson({ system: 's', prompt: 'p' })).rejects.toThrow(/no JSON object/);
  });
});
