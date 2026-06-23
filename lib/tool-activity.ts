/**
 * Pure derivations for the chat's tool-call disclosure pill (ToolActivityPill). Kept free of any
 * `motion`/React import so it runs in the node unit project and is testable in isolation. Reads the
 * Eve `useEveAgent` message `parts` (dynamic-tool + reasoning) and condenses them into the "what the
 * ranger did this turn" summary the pill renders. Source of truth is the stream — never model prose.
 */

export type ToolCallState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'
  | (string & {});

export interface ToolCallSummary {
  id: string;
  name: string;
  state: ToolCallState;
  input: unknown;
  /** The result card kind from `output.kind` once available (e.g. 'dark_sky_card'), else null. */
  resultKind: string | null;
  isError: boolean;
  /** True once the call has resolved (output available, errored, or denied) — i.e. no longer running. */
  done: boolean;
}

export interface ActivitySummary {
  toolCalls: ToolCallSummary[];
  reasoning: { text: string; streaming: boolean } | null;
}

/** The loose shape of an Eve assistant message part as seen client-side (only the fields we read). */
export interface ActivityPart {
  type?: string;
  text?: string;
  state?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
}

const DONE_STATES = new Set(['output-available', 'output-error', 'output-denied']);

/**
 * Condense an assistant message's parts into its tool calls (deduped by toolCallId, latest state wins,
 * original order preserved) and its reasoning (distinct reasoning chunks joined as steps). Returns
 * `reasoning: null` when the turn has no reasoning so the optional disclosure can be hidden.
 */
export function summarizeActivity(parts: readonly ActivityPart[]): ActivitySummary {
  const byId = new Map<string, ToolCallSummary>();
  const order: string[] = [];
  const reasoningChunks: string[] = [];
  let reasoningStreaming = false;

  parts.forEach((p, i) => {
    if (p.type === 'dynamic-tool') {
      const id = p.toolCallId ?? `${p.toolName ?? 'tool'}:${i}`;
      const out = p.output as { kind?: string } | undefined;
      const state = (p.state ?? 'input-streaming') as ToolCallState;
      if (!byId.has(id)) order.push(id);
      byId.set(id, {
        id,
        name: p.toolName ?? 'tool',
        state,
        input: p.input,
        resultKind: out?.kind ?? null,
        isError: state === 'output-error' || state === 'output-denied',
        done: DONE_STATES.has(state),
      });
    } else if (p.type === 'reasoning' && typeof p.text === 'string' && p.text.trim()) {
      reasoningChunks.push(p.text);
      if (p.state === 'streaming') reasoningStreaming = true;
    }
  });

  return {
    toolCalls: order.map((id) => byId.get(id) as ToolCallSummary),
    reasoning: reasoningChunks.length ? { text: reasoningChunks.join('\n\n'), streaming: reasoningStreaming } : null,
  };
}

/** Human label for a tool name (e.g. find_parks → "Finding parks"); unknown names are title-cased. */
const TOOL_LABELS: Record<string, string> = {
  find_parks: 'Finding parks',
  search_parks: 'Searching parks',
  parks_near: 'Parks nearby',
  get_park_details: 'Park details',
  get_weather: 'Checking weather',
  get_astro: "Tonight's sky",
  best_time_to_visit: 'Best time & dark sky',
  check_alerts: 'Checking alerts',
  check_trip_alerts: 'Checking trip alerts',
  build_itinerary: 'Building the itinerary',
  add_stop: 'Adding a stop',
  suggest_day_plan: 'Pacing the days',
  start_trip_from_tour: 'Seeding a trip from a tour',
  trip_conditions: 'Trip conditions',
  recommend_for_user: 'Recommending parks',
  explain_recommendation: 'Why this park',
  find_trail: 'Tracing a trail',
  find_place: 'Finding a place',
  find_person: 'Finding a person',
  save_preference: 'Saving a preference',
  set_travel_constraints: 'Noting your constraints',
  record_pass: 'Recording a pass',
  set_availability: 'Saving your travel dates',
  recall_user_context: 'Recalling your context',
};

export function toolLabel(name: string): string {
  const known = TOOL_LABELS[name];
  if (known) return known;
  return (
    name
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || name
  );
}
