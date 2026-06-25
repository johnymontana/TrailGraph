import { env } from './env';

/**
 * Text generation via the Vercel AI Gateway's OpenAI-compatible /chat/completions endpoint. Like
 * `lib/embeddings.ts#embed`, this is a DIRECT fetch (not the AI SDK) to stay off a fast-moving SDK
 * surface — the gateway's chat contract is stable. Model is config-swappable (defaults to the agent
 * model). Used by the offline Ranger School content pipeline (`lib/sync/decompose-lessons.ts`); the
 * request-time lesson-narrative cache (Phase 4) reuses it too.
 *
 * NOTE: this is exercised only when `DECOMPOSE_LESSONPLANS=1` (default off), so it spends no tokens in a
 * normal sync. Validate the live model call when first enabling that flag.
 */
const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1';

export interface GenerateOpts {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** One chat completion → the assistant's raw text. Throws on a non-OK gateway response. */
export async function generateText(opts: GenerateOpts): Promise<string> {
  if (!env.models.aiGatewayKey) throw new Error('AI_GATEWAY_API_KEY is not set');
  const res = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.models.aiGatewayKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model ?? env.models.agent,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.3,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI Gateway chat ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

/**
 * Extract a single JSON object from a model response, tolerating ```json fences and surrounding prose.
 * Pure + deterministic (unit-tested) so the content pipeline never crashes on a chatty model.
 */
export function parseJsonObject<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in model response');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

/** Generate + parse a JSON object in one call (prompt-enforced JSON; robust parse, no SDK response_format). */
export async function generateJson<T>(opts: GenerateOpts): Promise<T> {
  const text = await generateText({
    ...opts,
    system: `${opts.system}\n\nRespond with a single JSON object and nothing else.`,
  });
  return parseJsonObject<T>(text);
}
