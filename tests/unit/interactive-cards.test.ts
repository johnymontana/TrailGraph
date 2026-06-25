import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isRenderableToolOutput } from '../../lib/tool-output';

/**
 * Regression guard for the review's #1 finding (P0.1): a clarifying-question / quiz / draft-itinerary card
 * that ships server-side but never SURFACES — i.e. the interactive `{kind,data}` envelope is dropped or its
 * tap-back wiring is severed. The contract spans three hand-maintained places that must stay in lock-step:
 *   1. lib/tool-output.ts        — the renderability allowlist (or the card silently drops),
 *   2. components/chat/Cards.tsx — the `switch (kind)` arm rendering the interactive component WITH onAnswer,
 *   3. components/chat/ChatPanel — threads `onAnswer` into ToolCard, and only on the latest turn.
 * This parses the real source so removing any leg fails loudly, without needing a DOM/RTL harness.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, '../../', rel), 'utf8');
const cards = read('components/chat/Cards.tsx');
const chatPanel = read('components/chat/ChatPanel.tsx');

/** The interactive cards: a tap posts back via onAnswer. `component` is the function rendered by the arm. */
const INTERACTIVE = [
  { kind: 'question_card', component: 'QuestionCard', renderable: { prompt: 'Pick one', options: [{ id: 'a', label: 'A' }] } },
  { kind: 'quiz_card', component: 'QuizCard', renderable: { quizId: 'q1', stem: 'Q?', choices: [{ id: 'a', label: 'A' }] } },
  { kind: 'itinerary_preview', component: 'ItineraryCard', renderable: { trip: { id: 't', name: 'Trip', stops: [] } } },
] as const;

/** Extract the text of a `case '<kind>':` arm (up to the next `case`/`default`). */
function switchArm(src: string, kind: string): string {
  const start = src.indexOf(`case '${kind}':`);
  if (start < 0) return '';
  const rest = src.slice(start + `case '${kind}':`.length);
  const end = rest.search(/\n\s*(?:case '|default:)/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('interactive chat cards stay wired (allowlist ↔ switch ↔ onAnswer)', () => {
  for (const { kind, component, renderable } of INTERACTIVE) {
    describe(kind, () => {
      it('passes the renderability allowlist with a minimal payload and rejects empty', () => {
        expect(isRenderableToolOutput(kind, renderable)).toBe(true);
        expect(isRenderableToolOutput(kind, {})).toBe(false);
      });

      it(`has a Cards.tsx switch arm rendering <${component}> WITH onAnswer`, () => {
        const arm = switchArm(cards, kind);
        expect(arm, `missing 'case ${kind}:' in Cards.tsx switch`).not.toBe('');
        expect(arm).toContain(`<${component}`);
        expect(arm, `'${kind}' must thread onAnswer so a tap can post back`).toContain('onAnswer');
      });

      it(`the ${component} component references onAnswer (tap-back plumbing intact)`, () => {
        const fn = cards.indexOf(`function ${component}(`);
        expect(fn, `missing ${component} component`).toBeGreaterThan(-1);
        const body = cards.slice(fn, fn + 2000);
        expect(body).toContain('onAnswer');
      });
    });
  }

  it('ChatPanel mounts ToolCard WITH onAnswer, and only on the latest turn', () => {
    expect(chatPanel).toContain('onAnswer={onAnswer}');
    // Latest-turn gate: stale cards must be read-only (no onAnswer). Guard the actual guard expression.
    expect(chatPanel).toContain('i === messages.length - 1');
  });

  it('the QuestionCard tap posts the chosen option back (onAnswer(o.label))', () => {
    const fn = cards.indexOf('function QuestionCard(');
    const body = cards.slice(fn, fn + 2000);
    expect(body).toMatch(/onAnswer\?\.\(o\.label\)/);
  });
});
