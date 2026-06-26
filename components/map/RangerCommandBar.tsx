'use client';
import { useState, useRef, useEffect } from 'react';
import { Box, HStack, Stack, Text, Input, IconButton, Icon } from '@chakra-ui/react';
import { useEveAgent } from 'eve/react';
import { LuSend, LuSquare, LuSparkles, LuX } from 'react-icons/lu';
import { ToolCard, isRenderableToolOutput } from '../chat/Cards';
import { Markdown } from '../chat/Markdown';
import { ToolActivityPill } from '../chat/ToolActivityPill';
import { summarizeActivity, type ActivityPart } from '../../lib/tool-activity';
import { extractParkCards } from '../../lib/chat-parks';

/**
 * Natural-language command bar on the map (#7): a docked "mini-ranger" with its own Eve session (same-origin
 * channel, so the Better Auth cookie + the full ranger tool taxonomy come for free — no agent changes). Ask
 * "dark-sky parks within 200mi of Denver, open in October, wheelchair-accessible" and the model
 * geocodes/filters via find_parks/parks_near; when a turn lands park cards we fire `trailgraph:map-focus`
 * (parkCode + lat/lng) so MapExplorer highlights the matches and flies the camera. Results render below.
 */
export function RangerCommandBar() {
  const agent = useEveAgent({});
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const announced = useRef<Set<string>>(new Set());
  const messages = agent.data.messages;
  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const active = busy && !stopped;

  // When an assistant turn completes with located park cards, fly + highlight the map (the S5 bridge).
  useEffect(() => {
    for (const m of messages as { id?: string; role: string; parts: unknown[] }[]) {
      if (m.role !== 'assistant' || !m.id || announced.current.has(m.id)) continue;
      const parks = extractParkCards(m.parts as never);
      if (parks.length === 0) continue;
      announced.current.add(m.id);
      window.dispatchEvent(new CustomEvent('trailgraph:map-focus', { detail: { parks } }));
    }
  }, [messages]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setStopped(false);
    setInput('');
    setOpen(true);
    try {
      await agent.send({ message: msg });
    } catch {
      // First message after load can lose the lazy-session race — retry once, else restore the text.
      try {
        await new Promise((r) => setTimeout(r, 250));
        await agent.send({ message: msg });
      } catch {
        setInput((c) => (c === '' ? msg : c));
      }
    }
  }
  function stop() {
    agent.stop();
    setStopped(true);
  }

  const last = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <Box position="absolute" top={3} left="50%" transform="translateX(-50%)" w={{ base: '92%', md: '540px' }} maxW="92vw" zIndex={5}>
      <HStack bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="full" shadow="md" pl={3} pr={1.5} py={1.5} gap={2}>
        <Icon as={LuSparkles} color="brand.fg" flexShrink={0} />
        <Input
          size="sm"
          variant="subtle"
          bg="transparent"
          border="none"
          _focusVisible={{ boxShadow: 'none' }}
          placeholder="Ask the ranger — e.g. dark-sky parks near Denver open in October…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          disabled={busy}
        />
        {active ? (
          <IconButton aria-label="Stop" size="sm" colorPalette="red" borderRadius="full" onClick={stop} flexShrink={0}>
            <LuSquare />
          </IconButton>
        ) : (
          <IconButton aria-label="Ask the ranger" size="sm" colorPalette="pine" borderRadius="full" onClick={() => send()} loading={busy} disabled={!input.trim()} flexShrink={0}>
            <LuSend />
          </IconButton>
        )}
      </HStack>

      {open && (last || active) ? (
        <Box mt={2} bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" shadow="md" maxH="55vh" overflowY="auto" p={3}>
          <HStack justify="space-between" mb={1.5}>
            <Text fontSize="xs" color="fg.muted">Ranger</Text>
            <IconButton aria-label="Close results" size="2xs" variant="ghost" onClick={() => setOpen(false)}>
              <LuX />
            </IconButton>
          </HStack>
          {last ? <RangerTurn parts={last.parts as never} streaming={active} /> : <Text fontSize="sm" color="fg.muted">Asking the ranger…</Text>}
        </Box>
      ) : null}
    </Box>
  );
}

/** Render one assistant turn compactly: a "how I worked" pill, prose, and renderable tool cards (deduped). */
function RangerTurn({ parts, streaming }: { parts: { type: string; text?: string; state?: string; output?: unknown }[]; streaming: boolean }) {
  const activity = summarizeActivity(parts as unknown as ActivityPart[]);
  const seen = new Set<string>();
  return (
    <Stack gap={3}>
      {activity.toolCalls.length > 0 || activity.reasoning ? (
        <ToolActivityPill toolCalls={activity.toolCalls} reasoning={activity.reasoning} streaming={streaming} />
      ) : null}
      {parts.map((p, j) => {
        if (p.type === 'text' && p.text?.trim()) return <Markdown key={j}>{p.text}</Markdown>;
        if (p.type === 'dynamic-tool' && p.state === 'output-available') {
          const out = p.output as { kind?: string; data?: Record<string, unknown> } | undefined;
          if (!out?.kind || !isRenderableToolOutput(out.kind, out.data)) return null;
          const sig = out.kind + JSON.stringify(out.data ?? {});
          if (seen.has(sig)) return null;
          seen.add(sig);
          return <ToolCard key={j} kind={out.kind} data={out.data} />;
        }
        return null;
      })}
    </Stack>
  );
}
