import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Structural guard for the Stop (P1.1) + inline Retry (P0.2) wiring in ChatPanel. The behavior itself lives
 * in a client component (no DOM/RTL harness here), so we pin the contract by parsing the real source — this
 * fails loudly if the Stop control, its state machine, or the order-preserving Retry is removed/regressed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../components/chat/ChatPanel.tsx'), 'utf8');

describe('ChatPanel Stop control (P1.1)', () => {
  it('derives an `active` signal from busy AND a local stopped flag (instant settle)', () => {
    expect(src).toMatch(/const\s+\[stopped,\s*setStopped\]\s*=\s*useState\(false\)/);
    expect(src).toMatch(/const\s+active\s*=\s*busy\s*&&\s*!stopped/);
  });

  it('renders a Stop control that calls agent.stop() and flips stopped', () => {
    expect(src).toContain('agent.stop()');
    expect(src).toMatch(/aria-label="Stop generating"/);
    // The footer swaps Stop ↔ Send on `active`, so the Send button is never shown mid-stream.
    expect(src).toMatch(/\{active \? \(/);
  });

  it('clears the stopped flag when the next turn is sent', () => {
    expect(src).toMatch(/setStopped\(false\)/);
  });

  it('settles the transcript with `active` (not raw busy) so stopped turns stop streaming', () => {
    expect(src).toMatch(/const streaming = active &&/);
  });
});

describe('ChatPanel inline Retry + ordering (P0.2)', () => {
  it('shows the error/Retry affordance only in the error state', () => {
    expect(src).toMatch(/agent\.status === 'error'/);
    expect(src).toContain('Retry');
  });

  it('Retry re-sends the LAST user message (preserved + appended in order, never reordered)', () => {
    expect(src).toMatch(/function retry\(/);
    expect(src).toMatch(/messages\[i\]\.role === 'user'/); // walks back to the last user turn
    expect(src).toMatch(/void send\(text\)/); // re-sends it as a fresh, append-only turn
  });
});
