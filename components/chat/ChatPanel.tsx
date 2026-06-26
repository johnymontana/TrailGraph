'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Box, Stack, Text, Input, IconButton, Button, Flex, HStack, Icon, Badge, Link as CLink } from '@chakra-ui/react';
import { useEveAgent } from 'eve/react';
import { LuSend, LuSparkles, LuSquare, LuRotateCcw, LuTriangleAlert } from 'react-icons/lu';
import { ToolCard, isRenderableToolOutput } from './Cards';
import { Markdown } from './Markdown';
import { ToolActivityPill } from './ToolActivityPill';
import { summarizeActivity, type ActivityPart } from '../../lib/tool-activity';
import { decodeSeed } from '../../lib/graph-handoff';

const DEFAULT_SUGGESTIONS: ChatSuggestion[] = [
  '✨ Surprise me — plan something I\'d love',
  '4 days, mountains and easy hikes near Montana',
  'A dark-sky road trip in Utah',
  {
    label: '🎒 Plan a school field trip',
    message:
      'Help me plan an accessible one-day school field trip near us that ties to our curriculum. I\'ll tell you the grade level, subject, group size, date, and how far we can travel.',
  },
];

/**
 * A starter chip / interactive answer. A plain string is shown verbatim and sent verbatim (the legacy
 * shape, used by the main ranger chat). The object form decouples the human-visible `label`/`message`
 * (what the user sees in the chip and their chat bubble) from `clientContext` — Eve's EPHEMERAL,
 * not-persisted side-channel that carries ids (lessonId, quizId, choiceId) to the model WITHOUT putting
 * them in the visible message. Lets the Ranger School tutor ground to a lesson without leaking UUIDs.
 */
export type ChatSuggestion =
  | string
  | { label: string; message: string; clientContext?: Record<string, string> };

export interface ChatPanelProps {
  /** Starter prompt chips on the empty state (e.g. lesson-seeded tutor prompts for the lesson player). */
  suggestions?: ChatSuggestion[];
  /** Header identity (defaults to "The Ranger" / "Plans around what you love"). */
  title?: string;
  subtitle?: string;
  /** Empty-state lead line. */
  emptyHint?: string;
  /** Input placeholder. */
  placeholder?: string;
  /**
   * Full-fidelity transcript replay (lesson player). Seed the chat with a previously-saved Eve event stream
   * (`initialEvents`) + resumable session cursor (`initialSession`), and POST a snapshot to `persistUrl` after
   * each turn so the thread — WITH its interactive quiz/feedback cards — survives a reload. Defaults (all
   * undefined) preserve the main ranger chat exactly. NB: these seed the store ONCE at mount, so remount the
   * panel (e.g. `key={lessonId}`) to load a different lesson's transcript.
   */
  initialEvents?: unknown[];
  initialSession?: unknown;
  persistUrl?: string;
}

/**
 * Ranger chat (D1, D5) via Eve's native client, same-origin so the Better Auth cookie flows (R4).
 * - Renders assistant prose as Markdown, but as plain text while a message is still streaming so
 *   incomplete `**`/`#` tokens don't flash (R2 §3.4).
 * - De-dupes park cards by parkCode across ALL tool outputs in a message (R2 §2.3).
 * - Never shows an empty Ranger turn — falls back to a notice if nothing rendered (R2 §3.1).
 * Optional props let the Ranger School lesson player reuse it as a lesson-seeded tutor (no fork).
 */
export function ChatPanel({
  suggestions = DEFAULT_SUGGESTIONS,
  title = 'The Ranger',
  subtitle = 'Plans around what you love',
  emptyHint = 'Ask the ranger to plan a trip, find parks, or check conditions.',
  placeholder = 'Plan a trip with the ranger…',
  initialEvents,
  initialSession,
  persistUrl,
}: ChatPanelProps = {}) {
  const agent = useEveAgent({
    // Replay a saved transcript on mount (lesson player); undefined for the main chat → fresh session.
    initialEvents: initialEvents as never,
    initialSession: initialSession as never,
    // After each completed turn, persist the authoritative event stream + session cursor so a reload restores
    // the full thread (cards included). Fire-and-forget; `keepalive` lets it survive a navigation/unload.
    onFinish: persistUrl
      ? (snap) => {
          void fetch(persistUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ events: snap.events, session: snap.session }),
            keepalive: true,
          }).catch(() => {});
        }
      : undefined,
  });
  const [input, setInput] = useState('');
  // `stopped` = the user pressed Stop on the in-flight turn (P1.1). Eve's store aborts the client stream
  // and settles `status` back to `ready`, but we flip the UI to "settled" immediately rather than waiting
  // a tick — `active` is the user-facing "still generating" signal. NB: Stop only stops *watching*; the
  // server turn still completes (tokens spent, full reply persists server-side) — we don't claim otherwise.
  const [stopped, setStopped] = useState(false);
  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const active = busy && !stopped;
  const messages = agent.data.messages;
  const bottomRef = useRef<HTMLDivElement>(null);
  const announcedTrips = useRef<Set<string>>(new Set());
  const announcedGrades = useRef<Set<string>>(new Set());
  // The trip currently open in the sibling TripBuilder (P2.1). We can't share React state across the two
  // panes, so TripBuilder broadcasts it on a window event; we attach its dates as ephemeral Eve client
  // context on every send so dated dark-sky/astro answers reflect the trip window, not tonight.
  const activeTrip = useRef<{ id: string; name: string; startDate: string | null; endDate: string | null } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  // Track the TripBuilder's open trip (P2.1) so send() can attach its dates as client context.
  useEffect(() => {
    function onActive(e: Event) {
      activeTrip.current = (e as CustomEvent<typeof activeTrip.current>).detail ?? null;
    }
    window.addEventListener('trailgraph:active-trip', onActive);
    return () => window.removeEventListener('trailgraph:active-trip', onActive);
  }, []);

  // Plan-from-graph handoff (#10): /plan?seed=zion,bryce&from=graph seeds an itinerary ONCE on mount. The
  // codes ride as ephemeral clientContext (Record<string,string> — comma-joined, never an array); the agent
  // turns `seedParkCodes` into a propose_itinerary call (see agent/instructions.md). Clear the params via
  // replaceState so a refresh can't re-fire, and guard with a ref against the dev double-effect.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('from') !== 'graph') return;
    const codes = decodeSeed(sp.get('seed'));
    if (!codes.length) return;
    seededRef.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    void send('Plan a trip with the parks I picked on the graph.', { seedParkCodes: codes.join(','), seedFrom: 'graph' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the ranger saves a trip (an itinerary_preview tool result with a trip), tell the trip builder
  // to refresh + open it — without a page reload (R3 §4.2). Dispatch once per trip id.
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      for (const p of m.parts as { type?: string; state?: string; output?: unknown }[]) {
        if (p.type !== 'dynamic-tool' || p.state !== 'output-available') continue;
        const out = p.output as { kind?: string; data?: { trip?: { id?: string } } } | undefined;
        const tripId = out?.kind === 'itinerary_preview' ? out?.data?.trip?.id : undefined;
        if (tripId && !announcedTrips.current.has(tripId)) {
          announcedTrips.current.add(tripId);
          window.dispatchEvent(new CustomEvent('trailgraph:trips-changed', { detail: { tripId } }));
        }
      }
    }
  }, [messages]);

  // When the tutor grades a quiz (a quiz_feedback_card), announce it so the lesson player's progress rail
  // refreshes without a reload (docs/RANGER_SCHOOL_DESIGN.md §8). grade_answer writes COMPLETED synchronously
  // before the card streams, so the listener's router.refresh() always reads post-write state. Dedup per
  // graded turn by the assistant message id (re-grading is a new turn → a new id → a fresh announce).
  useEffect(() => {
    for (const m of messages as { id?: string; role: string; parts: { type?: string; state?: string; output?: unknown }[] }[]) {
      const mid = m.id;
      if (m.role !== 'assistant' || !mid || announcedGrades.current.has(mid)) continue;
      for (const p of m.parts) {
        if (p.type !== 'dynamic-tool' || p.state !== 'output-available') continue;
        const out = p.output as { kind?: string; data?: { quizId?: string; correct?: boolean } } | undefined;
        if (out?.kind !== 'quiz_feedback_card') continue;
        announcedGrades.current.add(mid);
        window.dispatchEvent(
          new CustomEvent('rangerschool:quiz-graded', { detail: { quizId: out.data?.quizId, correct: out.data?.correct } }),
        );
        break;
      }
    }
  }, [messages]);

  async function send(text?: string, clientContext?: Record<string, string>) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setStopped(false);
    setInput('');
    // `clientContext` rides ephemerally to the model only (ids for tutor grounding + the open trip's dates)
    // — never persisted, never shown as a bubble. Layer the active trip's window under any explicit context
    // (explicit wins) so dated dark-sky/astro answers reflect the trip window (P2.1).
    const at = activeTrip.current;
    const base: Record<string, string> = {};
    if (at?.id) base.activeTripId = at.id;
    if (at?.name) base.activeTripName = at.name;
    if (at?.startDate) base.activeTripStart = at.startDate;
    if (at?.endDate) base.activeTripEnd = at.endDate;
    const mergedCtx = { ...base, ...(clientContext ?? {}) };
    const payload = { message: msg, ...(Object.keys(mergedCtx).length ? { clientContext: mergedCtx } : {}) };
    try {
      await agent.send(payload);
    } catch {
      // The Eve session is created LAZILY server-side (persist-turn → getOrCreateConversation), so the very
      // first message typed right after page load can lose the race and reject (P0.3). A throw means the
      // message was NOT accepted, so it's safe to retry once after a tick — and if it still fails, restore
      // the text to the input rather than silently dropping it (the old `.catch(() => {})` did exactly that).
      try {
        await new Promise((r) => setTimeout(r, 250));
        await agent.send(payload);
      } catch {
        setInput((cur) => (cur === '' ? msg : cur));
      }
    }
  }

  /** Stop watching the in-flight turn (P1.1). Aborts the client stream via Eve's store; the server turn
   * still finishes, so no transcript cleanup is needed. `stopped` flips the UI to settled immediately. */
  function stopTurn() {
    agent.stop();
    setStopped(true);
  }

  /** Inline error recovery (P0.2): re-send the last user message. It stays visible (never reordered), and
   * the retried turn renders in chronological position after it. */
  function retry() {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const text = messages[i].parts.map((p) => (p.type === 'text' ? (p as { text?: string }).text ?? '' : '')).join('');
        if (text.trim()) void send(text);
        return;
      }
    }
  }

  function renderAssistant(
    parts: { type: string; text?: string; state?: string; output?: unknown }[],
    streaming: boolean,
    onAnswer?: (text: string, clientContext?: Record<string, string>) => void,
  ): ReactNode {
    const seenParks = new Set<string>();
    const seenSig = new Set<string>();
    const nodes: ReactNode[] = [];

    // Render only the LAST itinerary card per trip id (R5 §2.7): one trip build emits an itinerary_preview
    // from build_itinerary, suggest_day_plan, add_stop, … — keep the most complete (last) one, drop the
    // earlier near-duplicates. Draft proposals (no trip.id) are unaffected and fall through to seenSig.
    const lastItinIdxByTrip = new Map<string, number>();
    parts.forEach((part, j) => {
      if (part.type !== 'dynamic-tool' || part.state !== 'output-available') return;
      const out = part.output as { kind?: string; data?: { trip?: { id?: string } } } | undefined;
      const tid = out?.kind === 'itinerary_preview' ? out?.data?.trip?.id : undefined;
      if (tid) lastItinIdxByTrip.set(tid, j);
    });

    // "How I worked" header (ADR §7.7): expose the tool calls as a disclosure pill, with reasoning
    // behind an optional nested toggle. Reasoning is NO LONGER rendered inline below — it lives in the
    // pill. Source = the stream parts, never model prose.
    const activity = summarizeActivity(parts as unknown as ActivityPart[]);
    if (activity.toolCalls.length > 0 || activity.reasoning) {
      nodes.push(
        <ToolActivityPill key="activity" toolCalls={activity.toolCalls} reasoning={activity.reasoning} streaming={streaming} />,
      );
    }

    parts.forEach((part, j) => {
      if (part.type === 'text' && part.text?.trim()) {
        // Render Markdown incrementally even while streaming (R4 §2.4) so headings/tables/bold appear
        // progressively — react-markdown tolerates partial input — instead of showing seconds of raw
        // `###`/`|`/`**`. A half-typed token renders as literal for a frame, far better than the old
        // multi-second raw-syntax window.
        nodes.push(<Markdown key={j}>{part.text}</Markdown>);
      } else if (part.type === 'dynamic-tool' && part.state === 'output-available') {
        const out = part.output as { kind?: string; data?: unknown } | undefined;
        if (!out?.kind) return;
        let data = out.data as Record<string, unknown> | undefined;
        // Cross-output dedup of park cards by parkCode.
        if (out.kind === 'park_card' && data) {
          const list = (data.parks ?? (data.park ? [data.park] : [])) as { parkCode: string }[];
          const fresh = list.filter((p) => p.parkCode && !seenParks.has(p.parkCode));
          fresh.forEach((p) => seenParks.add(p.parkCode));
          if (fresh.length === 0) return;
          data = { ...data, parks: fresh, park: undefined };
        }
        // Skip all but the last itinerary card for a given trip id (R5 §2.7).
        if (out.kind === 'itinerary_preview') {
          const tid = (data as { trip?: { id?: string } } | undefined)?.trip?.id;
          if (tid && lastItinIdxByTrip.get(tid) !== j) return;
        }
        if (!isRenderableToolOutput(out.kind, data)) return;
        const sig = out.kind + JSON.stringify(data ?? {});
        if (seenSig.has(sig)) return;
        seenSig.add(sig);
        nodes.push(<ToolCard key={j} kind={out.kind} data={data} onAnswer={onAnswer} />);
      } else if (
        part.type === 'dynamic-tool' &&
        (part as { toolName?: string }).toolName === 'ask_question' &&
        part.state !== 'output-available'
      ) {
        // ask_question instructs the model to END the turn after calling it, so its passthrough output may
        // never reach `output-available` on the client — render the clarifying card from the tool INPUT
        // instead (for a passthrough, input === the card data) so the question always surfaces (P0.1). The
        // seenSig guard de-dupes if the real output part does arrive later.
        const data = (part as { input?: unknown }).input as Record<string, unknown> | undefined;
        if (!data || !isRenderableToolOutput('question_card', data)) return;
        const sig = 'question_card' + JSON.stringify(data ?? {});
        if (seenSig.has(sig)) return;
        seenSig.add(sig);
        nodes.push(<ToolCard key={j} kind="question_card" data={data} onAnswer={onAnswer} />);
      }
    });

    // Empty-message guard: only after streaming finishes (mid-stream emptiness is expected).
    if (nodes.length === 0 && !streaming) {
      nodes.push(<Text key="empty" fontSize="sm" color="fg.muted">_(no response — try again)_</Text>);
    }
    return nodes;
  }

  const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';

  return (
    <Flex direction="column" h="100%" bg="bg.canvas">
      {/* Ranger identity header */}
      <HStack px={4} py={3} borderBottomWidth="1px" borderColor="border" bg="bg.panel" gap={2} flexShrink={0}>
        <Box boxSize={7} borderRadius="full" bg="brand.solid" color="brand.contrast" display="flex" alignItems="center" justifyContent="center">
          <Icon as={LuSparkles} boxSize={4} />
        </Box>
        <Box>
          <Text fontSize="sm" fontWeight="semibold" fontFamily="heading" lineHeight="1.1">{title}</Text>
          <Text fontSize="xs" color="fg.muted" lineHeight="1.1">{subtitle}</Text>
        </Box>
      </HStack>

      <Stack flex="1" overflowY="auto" gap={5} p={4} minW={0}>
        {messages.length === 0 ? (
          <Stack gap={3} color="fg.muted" pt={4}>
            <Text>{emptyHint}</Text>
            <Stack gap={2} align="start">
              {suggestions.map((s) => {
                // Normalize: a plain string is shown + sent verbatim; the object form shows `label`, sends
                // `message`, and slips ids to the model via the ephemeral `clientContext` (never a bubble).
                const sg = typeof s === 'string' ? { label: s, message: s, clientContext: undefined } : s;
                return (
                  <Badge
                    key={sg.label}
                    as="button"
                    colorPalette="pine"
                    variant="subtle"
                    cursor="pointer"
                    px={3}
                    py={1.5}
                    textAlign="start"
                    whiteSpace="normal"
                    _hover={{ bg: 'brand.muted' }}
                    onClick={() => send(sg.message, sg.clientContext)}
                  >
                    {sg.label}
                  </Badge>
                );
              })}
            </Stack>
          </Stack>
        ) : null}

        {messages.map((m, i) => {
          const streaming = active && i === messages.length - 1 && m.role === 'assistant';
          if (m.role === 'user') {
            return (
              <Box key={i} alignSelf="flex-end" maxW="85%" minW={0}>
                <Text fontSize="xs" color="fg.muted" mb={1} textAlign="end">You</Text>
                <Box bg="brand.solid" color="brand.contrast" borderRadius="l2" borderBottomRightRadius="xs" px={3.5} py={2.5}>
                  <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
                    {m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
                  </Text>
                </Box>
              </Box>
            );
          }
          return (
            <HStack key={i} align="start" gap={2.5} maxW="92%" minW={0}>
              <Box boxSize={7} borderRadius="full" bg="brand.muted" color="brand.fg" display="flex" alignItems="center" justifyContent="center" flexShrink={0} mt={5}>
                <Icon as={LuSparkles} boxSize={3.5} />
              </Box>
              <Box minW={0} flex="1">
                <Text fontSize="xs" color="fg.muted" mb={1}>Ranger</Text>
                <Box bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="l2" borderTopLeftRadius="xs" px={4} py={3}>
                  {renderAssistant(
                    m.parts as never[],
                    streaming,
                    // Only the latest turn's question card is interactive — tapping sends the choice
                    // back as the user's next message (clean label) with ids carried in clientContext;
                    // stale cards stay read-only.
                    i === messages.length - 1
                      ? (text: string, clientContext?: Record<string, string>) => void send(text, clientContext)
                      : undefined,
                  )}
                </Box>
              </Box>
            </HStack>
          );
        })}

        {/* "Ranger is thinking…" — only before the assistant turn starts streaming (and not once stopped). */}
        {active && (agent.status === 'submitted' || lastIsUser) ? (
          <HStack align="center" gap={2.5}>
            <Box boxSize={7} borderRadius="full" bg="brand.muted" color="brand.fg" display="flex" alignItems="center" justifyContent="center">
              <Icon as={LuSparkles} boxSize={3.5} />
            </Box>
            <HStack gap={1.5} bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2.5}>
              <Text fontSize="sm" color="fg.muted">Ranger is thinking</Text>
              <HStack gap={0.5} color="brand.fg" fontWeight="bold">
                <Box css={{ animation: 'tgPulse 1.2s infinite' }}>·</Box>
                <Box css={{ animation: 'tgPulse 1.2s infinite 0.2s' }}>·</Box>
                <Box css={{ animation: 'tgPulse 1.2s infinite 0.4s' }}>·</Box>
              </HStack>
            </HStack>
          </HStack>
        ) : null}

        {agent.status === 'error' ? (
          <HStack borderWidth="1px" borderColor="orange.emphasized" bg="orange.subtle" borderRadius="l2" p={3} gap={3} align="center">
            <Icon as={LuTriangleAlert} color="orange.fg" flexShrink={0} />
            <Text fontSize="sm" color="orange.fg" flex="1">Something went wrong on my end — your message is safe.</Text>
            <Button size="sm" colorPalette="orange" variant="surface" onClick={retry} flexShrink={0}>
              <LuRotateCcw /> Retry
            </Button>
          </HStack>
        ) : null}
        <div ref={bottomRef} />
      </Stack>

      <Flex p={3} borderTopWidth="1px" borderColor="border" bg="bg.panel" gap={2} flexShrink={0}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={placeholder}
          disabled={busy}
          borderRadius="full"
          bg="bg.canvas"
        />
        {active ? (
          <IconButton aria-label="Stop generating" colorPalette="red" borderRadius="full" onClick={stopTurn}>
            <LuSquare />
          </IconButton>
        ) : (
          <IconButton aria-label="Send message" colorPalette="pine" borderRadius="full" onClick={() => send()} loading={busy} disabled={busy || !input.trim()}>
            <LuSend />
          </IconButton>
        )}
      </Flex>
    </Flex>
  );
}
