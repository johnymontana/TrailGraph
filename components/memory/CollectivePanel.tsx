'use client';
import { useEffect, useState } from 'react';
import { Box, Heading, Text, Stack, HStack, Switch, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { SkyLeaderboard, type LeaderboardEntry } from '../collective/SkyLeaderboard';
import { CrowdCurve, type Curve } from '../collective/CrowdCurve';

/** Opt-in collective intelligence (E5 + v2 ADR-053): peer picks, SQM leaderboard, crowd curves. */
interface Pick {
  parkCode: string;
  name: string;
  travelers: number;
}

export function CollectivePanel() {
  const [optIn, setOptIn] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [crowdCurves, setCrowdCurves] = useState<Curve[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/collective')
      .then((r) => (r.ok ? r.json() : { optIn: false, picks: [] }))
      .then((d) => {
        setOptIn(d.optIn);
        setPicks(d.picks ?? []);
        setLeaderboard(d.leaderboard ?? []);
        setCrowdCurves(d.crowdCurves ?? []);
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
      <Switch.Root colorPalette="pine" checked={optIn} onCheckedChange={(d) => toggle(!!d.checked)} mb={3}>
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
              <HStack key={p.parkCode} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
                <CLink asChild flex="1" color="brand.fg" fontWeight="medium"><NextLink href={`/parks/${p.parkCode}`}>{p.name}</NextLink></CLink>
                <Text fontSize="xs" color="fg.muted">{p.travelers} traveler{p.travelers === 1 ? '' : 's'}</Text>
              </HStack>
            ))}
          </Stack>
        )
      ) : null}

      {crowdCurves.length ? (
        <Box mt={8}>
          <Heading size="sm" mb={1}>When your wishlist is quietest</Heading>
          <Text fontSize="xs" color="fg.muted" mb={3}>
            Crowd curves for your considered parks — overlaid so you can spot a shared low-crowd window.
          </Text>
          <CrowdCurve curves={crowdCurves} />
        </Box>
      ) : null}

      <Box mt={8}>
        <Heading size="sm" mb={1}>Community dark-sky leaderboard</Heading>
        <Text fontSize="xs" color="fg.muted" mb={3}>
          Parks ranked by travelers’ median SQM readings (higher = darker). Log your own from any park page.
        </Text>
        <SkyLeaderboard entries={leaderboard} />
      </Box>
    </Box>
  );
}
