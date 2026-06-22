'use client';
import { useEffect, useState } from 'react';
import { Box, Heading, Text, Stack, HStack, Switch, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';

/** Opt-in collective intelligence (E5): "travelers like you also loved…". Anonymized counts only. */
interface Pick {
  parkCode: string;
  name: string;
  travelers: number;
}

export function CollectivePanel() {
  const [optIn, setOptIn] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/collective')
      .then((r) => (r.ok ? r.json() : { optIn: false, picks: [] }))
      .then((d) => {
        setOptIn(d.optIn);
        setPicks(d.picks ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function toggle(v: boolean) {
    const res = await fetch('/api/collective', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optIn: v }),
    });
    if (res.ok) {
      const d = await res.json();
      setOptIn(d.optIn);
      setPicks(d.picks ?? []);
    }
  }

  if (!loaded) return null;

  return (
    <Box mt={8}>
      <Heading size="sm" mb={1}>Travelers like you</Heading>
      <Text fontSize="xs" color="fg.muted" mb={3}>
        Opt in to see parks that travelers with similar tastes loved. Anonymized — counts only, never identities.
      </Text>
      <Switch.Root checked={optIn} onCheckedChange={(d) => toggle(!!d.checked)} mb={3}>
        <Switch.HiddenInput />
        <Switch.Control />
        <Switch.Label>Share my anonymized preferences to power suggestions</Switch.Label>
      </Switch.Root>

      {optIn ? (
        picks.length === 0 ? (
          <Text fontSize="sm" color="fg.muted">No suggestions yet — check back as more travelers opt in.</Text>
        ) : (
          <Stack gap={2}>
            {picks.map((p) => (
              <HStack key={p.parkCode} borderWidth="1px" borderRadius="md" p={2}>
                <CLink asChild flex="1"><NextLink href={`/parks/${p.parkCode}`}>{p.name}</NextLink></CLink>
                <Text fontSize="xs" color="fg.muted">{p.travelers} traveler{p.travelers === 1 ? '' : 's'}</Text>
              </HStack>
            ))}
          </Stack>
        )
      ) : null}
    </Box>
  );
}
