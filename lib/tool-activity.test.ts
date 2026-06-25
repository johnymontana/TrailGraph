import { describe, it, expect } from 'vitest';
import { summarizeActivity, toolLabel, type ActivityPart } from './tool-activity';

describe('toolLabel', () => {
  it('maps known tools to friendly labels', () => {
    expect(toolLabel('find_parks')).toBe('Finding parks');
    expect(toolLabel('get_astro')).toBe("Tonight's sky");
    expect(toolLabel('explain_recommendation')).toBe('Why this park');
  });
  it('title-cases unknown tool names', () => {
    expect(toolLabel('some_new_tool')).toBe('Some New Tool');
    expect(toolLabel('weather')).toBe('Weather');
  });
});

describe('summarizeActivity', () => {
  it('returns empty activity for a prose-only turn', () => {
    const parts: ActivityPart[] = [{ type: 'text', text: 'Here is your plan.' }];
    const a = summarizeActivity(parts);
    expect(a.toolCalls).toEqual([]);
    expect(a.reasoning).toBeNull();
  });

  it('derives state, input, resultKind, done/error from a dynamic-tool part', () => {
    const parts: ActivityPart[] = [
      { type: 'dynamic-tool', toolCallId: 'c1', toolName: 'get_weather', state: 'output-available', input: { parkCode: 'brca' }, output: { kind: 'weather_card', data: {} } },
    ];
    const [tc] = summarizeActivity(parts).toolCalls;
    expect(tc).toMatchObject({ id: 'c1', name: 'get_weather', state: 'output-available', resultKind: 'weather_card', done: true, isError: false });
    expect(tc.input).toEqual({ parkCode: 'brca' });
  });

  it('dedupes by toolCallId keeping the latest state, preserving first-seen order', () => {
    const parts: ActivityPart[] = [
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'find_parks', state: 'input-streaming' },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'get_astro', state: 'input-available', input: { parkCode: 'brca' } },
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
    ];
    const calls = summarizeActivity(parts).toolCalls;
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']); // order preserved, no dupes
    expect(calls[0].state).toBe('output-available'); // latest wins
    expect(calls[0].done).toBe(true);
    expect(calls[1].done).toBe(false); // still running
  });

  it('flags errored/denied calls', () => {
    const parts: ActivityPart[] = [
      { type: 'dynamic-tool', toolCallId: 'e', toolName: 'find_parks', state: 'output-error' },
    ];
    const [tc] = summarizeActivity(parts).toolCalls;
    expect(tc.isError).toBe(true);
    expect(tc.done).toBe(true);
  });

  it('synthesizes an id when toolCallId is missing', () => {
    const parts: ActivityPart[] = [{ type: 'dynamic-tool', toolName: 'get_weather', state: 'input-available' }];
    expect(summarizeActivity(parts).toolCalls[0].id).toBe('get_weather:0');
  });

  it('marks a back-to-back same-tool retry as superseded (P0.4), keeping the final call', () => {
    const parts: ActivityPart[] = [
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
    ];
    const calls = summarizeActivity(parts).toolCalls;
    expect(calls.map((c) => c.superseded)).toEqual([true, undefined]);
  });

  it('does NOT supersede the same tool when separated by another tool (distinct searches stay visible)', () => {
    const parts: ActivityPart[] = [
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
      { type: 'dynamic-tool', toolCallId: 'x', toolName: 'accessibility_scorecard', state: 'output-available', output: { kind: 'accessibility_card' } },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
    ];
    const calls = summarizeActivity(parts).toolCalls;
    expect(calls.every((c) => !c.superseded)).toBe(true);
  });

  it('never supersedes an errored call (honesty: keep error chips visible)', () => {
    const parts: ActivityPart[] = [
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 'find_parks', state: 'output-error' },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
    ];
    const calls = summarizeActivity(parts).toolCalls;
    expect(calls[0].superseded).toBeUndefined();
  });

  it('concatenates reasoning chunks as steps and tracks streaming', () => {
    const parts: ActivityPart[] = [
      { type: 'reasoning', text: 'Step one.', state: 'done' },
      { type: 'dynamic-tool', toolCallId: 'c', toolName: 'find_parks', state: 'output-available', output: { kind: 'park_card' } },
      { type: 'reasoning', text: 'Step two.', state: 'streaming' },
    ];
    const a = summarizeActivity(parts);
    expect(a.reasoning).toEqual({ text: 'Step one.\n\nStep two.', streaming: true });
    expect(a.toolCalls).toHaveLength(1);
  });

  it('ignores blank reasoning and non-activity parts', () => {
    const parts: ActivityPart[] = [
      { type: 'reasoning', text: '   ', state: 'done' },
      { type: 'step-start' },
      { type: 'text', text: 'hi' },
    ];
    const a = summarizeActivity(parts);
    expect(a.reasoning).toBeNull();
    expect(a.toolCalls).toEqual([]);
  });
});
