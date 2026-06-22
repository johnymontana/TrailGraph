'use client';
import { useState } from 'react';
import { Box, Heading, Text, Stack, HStack, Button, Badge } from '@chakra-ui/react';

/**
 * Official NPS tours for a park (NPS-expansion P1 #3). Each tour is an ordered graph path; "Start a
 * trip" seeds a new trip from its stops and deep-links into the builder (/plan?trip=…). No-ops
 * gracefully for anonymous users (the API returns 401 → we show a sign-in hint).
 */
export function TourList({
  parkName,
  tours,
}: {
  parkName: string;
  tours: { id: string; title: string; description: string | null; stops: number }[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start(tourId: string) {
    setBusyId(tourId);
    setErr(null);
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTourId: tourId }),
      });
      if (res.status === 401) {
        setErr('Sign in to start a trip from a tour.');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.id) {
        setErr(data.error ?? 'Could not start a trip from that tour.');
        return;
      }
      window.location.href = `/plan?trip=${data.id}`;
    } catch {
      setErr('Could not start a trip from that tour.');
    } finally {
      setBusyId(null);
    }
  }

  if (tours.length === 0) return null;

  return (
    <Box mt={12}>
      <Heading size="md" mb={1}>Take a tour</Heading>
      <Text fontSize="sm" color="fg.muted" mb={3}>
        Official NPS tours of {parkName} — each is an ordered path you can turn into a trip and remix.
      </Text>
      {err ? (
        <Text fontSize="sm" color="red.500" mb={2}>{err}</Text>
      ) : null}
      <Stack gap={2}>
        {tours.map((t) => (
          <HStack key={t.id} borderWidth="1px" borderRadius="md" p={3} align="start">
            <Box flex="1" minW={0}>
              <HStack mb={1}>
                <Text fontWeight="medium">{t.title}</Text>
                {t.stops > 0 ? <Badge colorPalette="blue">{t.stops} stop{t.stops === 1 ? '' : 's'}</Badge> : null}
              </HStack>
              {t.description ? (
                <Text fontSize="sm" color="fg.muted" lineClamp={2}>{t.description}</Text>
              ) : null}
            </Box>
            <Button size="sm" colorPalette="blue" variant="outline" disabled={busyId === t.id}
              onClick={() => start(t.id)}>
              {busyId === t.id ? 'Starting…' : 'Start a trip'}
            </Button>
          </HStack>
        ))}
      </Stack>
    </Box>
  );
}
