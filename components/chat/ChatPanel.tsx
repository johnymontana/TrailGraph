'use client';
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Box, Stack, Text, Input, IconButton, Flex, HStack, Icon, Badge, Link as CLink } from '@chakra-ui/react';
import { useEveAgent } from 'eve/react';
import { LuSend, LuSparkles } from 'react-icons/lu';
import { ToolCard, isRenderableToolOutput } from './Cards';
import { Markdown } from './Markdown';
import { ToolActivityPill } from './ToolActivityPill';
import { summarizeActivity, type ActivityPart } from '../../lib/tool-activity';

const SUGGESTIONS = [
  '4 days, mountains and easy hikes near Montana',
  'A dark-sky road trip in Utah',
  'Fewer crowds, waterfalls, kid-friendly',
];

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

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput('');
    await agent.send({ message: msg });
  }

  function renderAssistant(
    parts: { type: string; text?: string; state?: string; output?: unknown }[],
    streaming: boolean,
    onAnswer?: (text: string) => void,
  ): ReactNode {
    const seenParks = new Set<string>();
    const seenSig = new Set<string>();
    const nodes: ReactNode[] = [];

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
        if (!isRenderableToolOutput(out.kind, data)) return;
        const sig = out.kind + JSON.stringify(data ?? {});
        if (seenSig.has(sig)) return;
        seenSig.add(sig);
        nodes.push(<ToolCard key={j} kind={out.kind} data={data} onAnswer={onAnswer} />);
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
          <Text fontSize="sm" fontWeight="semibold" fontFamily="heading" lineHeight="1.1">The Ranger</Text>
          <Text fontSize="xs" color="fg.muted" lineHeight="1.1">Plans around what you love</Text>
        </Box>
      </HStack>

      <Stack flex="1" overflowY="auto" gap={5} p={4} minW={0}>
        {messages.length === 0 ? (
          <Stack gap={3} color="fg.muted" pt={4}>
            <Text>Ask the ranger to plan a trip, find parks, or check conditions.</Text>
            <Stack gap={2} align="start">
              {SUGGESTIONS.map((s) => (
                <Badge
                  key={s}
                  as="button"
                  colorPalette="pine"
                  variant="subtle"
                  cursor="pointer"
                  px={3}
                  py={1.5}
                  textAlign="start"
                  whiteSpace="normal"
                  _hover={{ bg: 'brand.muted' }}
                  onClick={() => send(s)}
                >
                  {s}
                </Badge>
              ))}
            </Stack>
          </Stack>
        ) : null}

        {messages.map((m, i) => {
          const streaming = busy && i === messages.length - 1 && m.role === 'assistant';
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
                    // back as the user's next message; stale cards stay read-only.
                    i === messages.length - 1 ? (text: string) => void send(text) : undefined,
                  )}
                </Box>
              </Box>
            </HStack>
          );
        })}

        {/* "Ranger is thinking…" — only before the assistant turn starts streaming. */}
        {agent.status === 'submitted' || (busy && lastIsUser) ? (
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

        {agent.error ? (
          <Text color="red.fg" fontSize="sm">The ranger hit an error. Try again.</Text>
        ) : null}
        <div ref={bottomRef} />
      </Stack>

      <Flex p={3} borderTopWidth="1px" borderColor="border" bg="bg.panel" gap={2} flexShrink={0}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Plan a trip with the ranger…"
          disabled={busy}
          borderRadius="full"
          bg="bg.canvas"
        />
        <IconButton aria-label="Send message" colorPalette="pine" borderRadius="full" onClick={() => send()} loading={busy} disabled={!input.trim()}>
          <LuSend />
        </IconButton>
      </Flex>
    </Flex>
  );
}
