'use client';
import { useState, useEffect } from 'react';
import { Box, Heading, Stack, HStack, Text, Badge, Button, Link as CLink, Spinner } from '@chakra-ui/react';
import NextLink from 'next/link';
import type { UserMemory } from '../../lib/memory-graph';

/**
 * "Your memory" surface (E3/E4). Users view, give feedback on, and DELETE remembered facts. Deletes
 * are durable (server tombstones them so extraction won't resurrect them — ADR-016, §13.4).
 */
export function MemoryList({ initial }: { initial: UserMemory }) {
  const [mem, setMem] = useState<UserMemory>(initial);
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState(true);

  // On load, reconcile NAMS-extracted chat preferences into the graph so implicit prefs show up
  // here (§2.1/§5), then refresh. Eventually-consistent — this "catches up" the display.
  useEffect(() => {
    fetch('/api/memory/reconcile', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.memory) setMem(d.memory);
      })
      .catch(() => {})
      .finally(() => setLearning(false));
  }, []);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) setMem(await res.json());
    setBusy(false);
  }

  return (
    <Stack gap={8}>
      <Box>
        <HStack mb={1}>
          <Heading size="sm">Preferences</Heading>
          {learning ? (
            <HStack color="fg.muted" gap={1}>
              <Spinner size="xs" />
              <Text fontSize="xs">Learning from your recent chats…</Text>
            </HStack>
          ) : null}
        </HStack>
        <Text fontSize="xs" color="fg.muted" mb={3}>
          What we&apos;ve learned you like. It can be wrong — give feedback or delete anything.
        </Text>
        {mem.preferences.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">Nothing yet. Tell the ranger what you enjoy and it&apos;ll show here.</Text>
        ) : (
          <Stack gap={2}>
            {mem.preferences.map((p) => (
              <HStack key={`${p.kind}:${p.name}`} borderWidth="1px" borderRadius="md" p={2}>
                <Badge colorPalette={p.kind === 'activity' ? 'blue' : 'green'}>{p.kind}</Badge>
                <Text flex="1">
                  {p.name}
                  {p.value && p.value.toLowerCase() !== p.name.toLowerCase() ? (
                    <Text as="span" color="fg.muted"> — you said “{p.value}”</Text>
                  ) : null}
                </Text>
                {p.weight != null && p.weight !== 1 ? (
                  <Badge colorPalette={p.weight < 1 ? 'gray' : 'purple'} title="Influence on your recommendations">
                    {p.weight < 1 ? '↓' : '↑'}{p.weight}×
                  </Badge>
                ) : null}
                <Button size="xs" variant="ghost" disabled={busy} title="Down-rank in recommendations"
                  onClick={() => act({ op: 'setWeight', kind: p.kind, name: p.name, weight: Math.max(0, Math.round(((p.weight ?? 1) - 0.5) * 10) / 10) })}>Less</Button>
                <Button size="xs" variant="ghost" disabled={busy} title="Boost in recommendations"
                  onClick={() => act({ op: 'setWeight', kind: p.kind, name: p.name, weight: Math.min(3, Math.round(((p.weight ?? 1) + 0.5) * 10) / 10) })}>More</Button>
                <Button size="xs" variant={p.feedback === 'up' ? 'solid' : 'ghost'} disabled={busy}
                  onClick={() => act({ op: 'feedback', kind: p.kind, name: p.name, vote: 'up' })}>👍</Button>
                <Button size="xs" variant={p.feedback === 'down' ? 'solid' : 'ghost'} disabled={busy}
                  onClick={() => act({ op: 'feedback', kind: p.kind, name: p.name, vote: 'down' })}>👎</Button>
                <Button size="xs" colorPalette="red" variant="ghost" disabled={busy}
                  onClick={() => act({ op: 'deletePreference', kind: p.kind, name: p.name })}>Delete</Button>
              </HStack>
            ))}
          </Stack>
        )}
      </Box>

      <Box>
        <Heading size="sm" mb={3}>Parks you&apos;ve considered</Heading>
        {mem.considered.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">None yet.</Text>
        ) : (
          <Stack gap={2}>
            {mem.considered.map((c) => (
              <HStack key={c.parkCode} borderWidth="1px" borderRadius="md" p={2}>
                <CLink asChild flex="1"><NextLink href={`/parks/${c.parkCode}`}>{c.name}</NextLink></CLink>
                <Button size="xs" colorPalette="red" variant="ghost" disabled={busy}
                  onClick={() => act({ op: 'deleteConsidered', parkCode: c.parkCode })}>Delete</Button>
              </HStack>
            ))}
          </Stack>
        )}
      </Box>

      <Box>
        <Heading size="sm" mb={3}>Your trips</Heading>
        {mem.planned.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">No trips planned yet.</Text>
        ) : (
          <Stack gap={2}>
            {mem.planned.map((t) => (
              <Text key={t.tripId}>{t.name}</Text>
            ))}
          </Stack>
        )}
      </Box>

      <Text fontSize="xs" color="fg.muted">
        TrailGraph&apos;s memory learns and improves, and it can be wrong — you&apos;re always in control here.
      </Text>
    </Stack>
  );
}
