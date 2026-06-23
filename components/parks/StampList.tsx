'use client';
import { useState } from 'react';
import { Box, Heading, Text, Stack, HStack, Button } from '@chakra-ui/react';

/**
 * Passport stamp collection toggle for a park (NPS-expansion P2 #8). Marking a stamp writes
 * `(:User)-[:COLLECTED]->(:PassportStamp)` via /api/memory — the collection is durable memory that
 * powers "stamps along my route" and shows on /me. No-ops gracefully for anonymous users.
 */
export function StampList({
  stamps,
}: {
  stamps: { id: string; label: string; collected: boolean }[];
}) {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(stamps.map((s) => [s.id, s.collected])),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(id: string) {
    const next = !state[id];
    setBusy(true);
    setErr(null);
    setState((s) => ({ ...s, [id]: next }));
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: next ? 'collectStamp' : 'uncollectStamp', stampId: id }),
      });
      if (!res.ok) {
        setErr(res.status === 401 ? 'Sign in to collect stamps.' : 'Failed to update stamp. Please try again.');
        setState((s) => ({ ...s, [id]: !next })); // revert
      }
    } catch {
      setErr('Network error. Please try again.');
      setState((s) => ({ ...s, [id]: !next })); // revert
    }
    setBusy(false);
  }

  if (stamps.length === 0) return null;

  return (
    <Box mt={12}>
      <Heading size="md" mb={1}>Passport stamps</Heading>
      <Text fontSize="sm" color="fg.muted" mb={3}>Mark the stamps you&apos;ve collected — they show in your memory and along your routes.</Text>
      {err ? <Text fontSize="sm" color="red.fg" mb={2}>{err}</Text> : null}
      <Stack gap={2}>
        {stamps.map((s) => (
          <HStack key={s.id} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
            <Text flex="1">🎫 {s.label}</Text>
            <Button size="xs" disabled={busy}
              colorPalette={state[s.id] ? 'pine' : 'sand'}
              variant={state[s.id] ? 'solid' : 'outline'}
              onClick={() => toggle(s.id)}>
              {state[s.id] ? 'Collected ✓' : 'Collect'}
            </Button>
          </HStack>
        ))}
      </Stack>
    </Box>
  );
}
