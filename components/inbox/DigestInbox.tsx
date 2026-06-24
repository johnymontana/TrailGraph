'use client';
import { useEffect, useState } from 'react';
import { Badge, Box, Button, Heading, HStack, Stack, Switch, Text } from '@chakra-ui/react';
import { LuInbox, LuTrash2 } from 'react-icons/lu';
import { DigestItems, type DigestItemView } from './DigestItems';

/**
 * Proactive Ranger inbox (ADR-052) — the always-on /me surface: today's digests, the user's standing
 * watches, and the email opt-in (default OFF). "Refresh digest" builds the rollup on demand so the value
 * is visible without waiting for the morning cron. Client; reads/writes /api/inbox.
 */
interface Digest {
  id: string;
  forDate: string;
  read: boolean;
  items: DigestItemView[];
}
interface Watch {
  id: string;
  kind: string;
  refId: string;
  label: string | null;
}

export function DigestInbox() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [emailDigest, setEmailDigest] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch('/api/inbox');
    if (r.ok) {
      const d = await r.json();
      setDigests(d.digests ?? []);
      setWatches(d.watches ?? []);
      setEmailDigest(!!d.emailDigest);
    }
    setLoaded(true);
  }
  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch('/api/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const latest = digests[0];

  return (
    <Box mt={8}>
      <HStack mb={1} gap={2}>
        <LuInbox />
        <Heading size="sm">Ranger inbox</Heading>
      </HStack>
      <Text fontSize="xs" color="fg.muted" mb={3}>
        A daily rollup of closures, clear-sky new-moon windows, fee-free days, and alerts for the trips &amp; parks you watch.
      </Text>

      <HStack mb={3} gap={3} wrap="wrap">
        <Button size="sm" colorPalette="pine" onClick={() => post({ op: 'build' })} loading={busy}>
          Refresh digest
        </Button>
        <Switch.Root colorPalette="pine" checked={emailDigest} onCheckedChange={(d) => post({ op: 'emailOptIn', value: !!d.checked })}>
          <Switch.HiddenInput />
          <Switch.Control />
          <Switch.Label>Email me the digest</Switch.Label>
        </Switch.Root>
      </HStack>

      {latest ? (
        <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={3} mb={4}>
          <HStack justify="space-between" mb={2}>
            <Text fontSize="sm" fontWeight="semibold" fontFamily="heading">
              {latest.forDate}
            </Text>
            {!latest.read ? <Badge colorPalette="trail" variant="solid">new</Badge> : null}
          </HStack>
          <DigestItems items={latest.items} />
          {!latest.read ? (
            <Button size="xs" variant="ghost" mt={2} onClick={() => post({ op: 'read', digestId: latest.id })}>
              Mark read
            </Button>
          ) : null}
        </Box>
      ) : (
        <Text fontSize="sm" color="fg.muted" mb={4}>
          No digest yet — add a watch below, then “Refresh digest”.
        </Text>
      )}

      <Heading size="xs" mb={2} color="fg.muted" textTransform="uppercase" letterSpacing="0.05em">
        Watching
      </Heading>
      {watches.length ? (
        <Stack gap={2}>
          {watches.map((w) => (
            <HStack key={w.id} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2} gap={2}>
              <Badge colorPalette={w.kind === 'trip' ? 'pine' : 'trail'}>{w.kind}</Badge>
              <Text fontSize="sm" flex="1">{w.label ?? w.refId}</Text>
              <Button size="xs" variant="ghost" onClick={() => post({ op: 'removeWatch', watchId: w.id })} aria-label="Remove watch">
                <LuTrash2 />
              </Button>
            </HStack>
          ))}
        </Stack>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          Nothing watched yet. Ask the ranger to “watch my Utah trip”, or watch a park from chat.
        </Text>
      )}
    </Box>
  );
}
