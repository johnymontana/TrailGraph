import { describe, it, expect } from 'vitest';
import { callerId, sessionId } from './agent-ctx';
import type { ToolContext } from 'eve/tools';

// Minimal ToolContext stand-ins — we only touch session.id and session.auth.current.principalId.
function ctx(principalId?: string): ToolContext {
  return {
    session: { id: 'sess-123', auth: principalId ? { current: { principalId } } : {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('callerId (R4 — server-bound identity)', () => {
  it('returns the authenticated principalId from the session', () => {
    expect(callerId(ctx('user-abc'))).toBe('user-abc');
  });

  it('throws when there is no authenticated principal (never falls back to a model-supplied id)', () => {
    expect(() => callerId(ctx())).toThrow(/Unauthenticated/);
  });
});

describe('sessionId', () => {
  it('returns the Eve session id (mapped to the NAMS conversationId)', () => {
    expect(sessionId(ctx('user-abc'))).toBe('sess-123');
  });
});
