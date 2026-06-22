'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Box, Stack, Text, Input, Button, Flex, Spinner } from '@chakra-ui/react';
import { useEveAgent } from 'eve/react';
import { ToolCard, isRenderableToolOutput } from './Cards';
import { Markdown } from './Markdown';

/**
 * Ranger chat (D1, D5) via Eve's native client, same-origin so the Better Auth cookie flows (R4).
 * - Renders assistant prose as Markdown, but as plain text while a message is still streaming so
 *   incomplete `**`/`#` tokens don't flash (R2 §3.4).
 * - De-dupes park cards by parkCode across ALL tool outputs in a message (R2 §2.3).
 * - Never shows an empty Ranger turn — falls back to a notice if nothing rendered (R2 §3.1).
 */
export function ChatPanel() {
  const agent = useEveAgent();
  const [input, setInput] = useState('');
  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const messages = agent.data.messages;
  const bottomRef = useRef<HTMLDivElement>(null);
  const announcedTrips = useRef<Set<string>>(new Set());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

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

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    await agent.send({ message: text });
  }

  function renderAssistant(parts: { type: string; text?: string; state?: string; output?: unknown }[], streaming: boolean): ReactNode {
    const seenParks = new Set<string>();
    const seenSig = new Set<string>();
    const nodes: ReactNode[] = [];

    parts.forEach((part, j) => {
      if (part.type === 'text' && part.text?.trim()) {
        // Render Markdown incrementally even while streaming (R4 §2.4) so headings/tables/bold appear
        // progressively — react-markdown tolerates partial input — instead of showing seconds of raw
        // `###`/`|`/`**`. A half-typed token renders as literal for a frame, far better than the old
        // multi-second raw-syntax window.
        nodes.push(<Markdown key={j}>{part.text}</Markdown>);
      } else if (part.type === 'reasoning' && part.text) {
        nodes.push(<Text key={j} fontSize="xs" color="fg.muted" fontStyle="italic">{part.text}</Text>);
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
        if (!isRenderableToolOutput(out.kind, data)) return;
        const sig = out.kind + JSON.stringify(data ?? {});
        if (seenSig.has(sig)) return;
        seenSig.add(sig);
        nodes.push(<ToolCard key={j} kind={out.kind} data={data} />);
      }
    });

    // Empty-message guard: only after streaming finishes (mid-stream emptiness is expected).
    if (nodes.length === 0 && !streaming) {
      nodes.push(<Text key="empty" fontSize="sm" color="fg.muted">_(no response — try again)_</Text>);
    }
    return nodes;
  }

  return (
    <Flex direction="column" h="100%">
      <Stack flex="1" overflowY="auto" gap={4} p={4} minW={0}>
        {messages.length === 0 ? (
          <Text color="fg.muted">
            Ask the ranger to plan a trip — e.g. “4 days, mountains and easy hikes near Montana.”
          </Text>
        ) : null}

        {messages.map((m, i) => {
          const streaming = busy && i === messages.length - 1 && m.role === 'assistant';
          return (
            <Box key={i} alignSelf={m.role === 'user' ? 'flex-end' : 'flex-start'} maxW="90%" minW={0}>
              <Text fontSize="xs" color="fg.muted" mb={1}>{m.role === 'user' ? 'You' : 'Ranger'}</Text>
              {m.role === 'user' ? (
                <Box bg="bg.subtle" borderRadius="md" px={3} py={2}>
                  <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
                    {m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
                  </Text>
                </Box>
              ) : (
                renderAssistant(m.parts as never[], streaming)
              )}
            </Box>
          );
        })}
        {busy ? <Spinner size="sm" /> : null}
        {agent.error ? <Text color="red.500" fontSize="sm">The ranger hit an error. Try again.</Text> : null}
        <div ref={bottomRef} />
      </Stack>

      <Flex p={3} borderTopWidth="1px" gap={2}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Plan a trip with the ranger…"
          disabled={busy}
        />
        <Button colorPalette="blue" onClick={send} loading={busy}>Send</Button>
      </Flex>
    </Flex>
  );
}
