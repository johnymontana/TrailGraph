'use client';
import { useState } from 'react';
import { Badge, Box, Button, HStack, Input, Stack, Text } from '@chakra-ui/react';
import type { SeedNode, SeedLink } from '../../lib/graph-nvl';

export interface GraphQueryAnswer {
  narration: string;
  nodes: SeedNode[];
  links: SeedLink[];
  intent?: string;
  candidates?: { intent: string; label: string }[];
}

/**
 * On-page "ask the graph" bar (#5a). Posts a natural-language question to `/api/graph/query`, which maps
 * it to a curated parameterized intent and returns a narrated answer + subgraph (or disambiguation chips).
 * The chat ranger's `ask_graph` tool is the full-power NL path; this bar is the in-canvas shortcut.
 */
export function GraphQueryBar({
  onResult,
  onClear,
  active,
  answer,
}: {
  onResult: (a: GraphQueryAnswer) => void;
  onClear: () => void;
  active: boolean;
  answer: GraphQueryAnswer | null;
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const query = q.trim();
    if (query.length < 3) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/graph/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      if (!res.ok) {
        setError(res.status === 429 ? 'Too many questions — try again shortly.' : 'Query failed.');
        return;
      }
      onResult((await res.json()) as GraphQueryAnswer);
    } catch {
      setError('Query failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Stack position="absolute" top={3} left="50%" transform="translateX(-50%)" zIndex={2} w="min(92vw, 460px)" bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" gap={1} data-testid="graph-query-bar">
      <HStack gap={2}>
        <Input
          size="sm"
          placeholder="Ask the graph… e.g. parks connected to John Muir"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask();
          }}
          aria-label="Ask the graph"
        />
        <Button size="sm" colorPalette="pine" loading={loading} onClick={ask}>
          Ask
        </Button>
        {active ? (
          <Button size="sm" variant="outline" onClick={onClear} aria-label="Back to the full graph">
            ← Back
          </Button>
        ) : null}
      </HStack>
      {error ? (
        <Text fontSize="xs" color="danger">{error}</Text>
      ) : answer ? (
        <Stack gap={1}>
          {answer.narration ? <Text fontSize="xs" color="fg.muted">{answer.narration}</Text> : null}
          {answer.candidates?.length ? (
            <HStack gap={2} wrap="wrap">
              {answer.candidates.map((c) => (
                <Badge key={c.intent} variant="subtle" colorPalette="pine">{c.label}</Badge>
              ))}
            </HStack>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}
