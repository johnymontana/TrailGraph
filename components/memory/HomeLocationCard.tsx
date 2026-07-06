'use client';
import { useState } from 'react';
import { Box, Heading, HStack, Text, Button, Input, Icon } from '@chakra-ui/react';
import { LuHouse, LuLocateFixed } from 'react-icons/lu';
import type { HomeLocation } from '../../lib/bridges';

/**
 * Home location editor on /me (user-feedback iteration): the durable "trips start from home" anchor.
 * Three capture paths — free-text geocode, browser geolocation (reverse-geocoded server-side so the
 * ORS key stays private), or the ranger's set_home_location tool. Clearing DETACH DELETEs the :Home node.
 */
export function HomeLocationCard({ initial }: { initial: HomeLocation | null }) {
  const [home, setHome] = useState<HomeLocation | null>(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me/home', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { home?: HomeLocation | null; error?: string };
      if (!res.ok) setError(data.error ?? 'Could not save your home location');
      else {
        setHome(data.home ?? null);
        setDraft('');
      }
    } catch {
      setError('Could not save your home location');
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('Location is not available in this browser');
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => save({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => {
        setBusy(false);
        setError('Location permission denied — type your city instead');
      },
    );
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/me/home', { method: 'DELETE' });
      setHome(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={4} mt={6} bg="bg.panel">
      <HStack gap={2} mb={1}>
        <Icon color="fg.muted"><LuHouse /></Icon>
        <Heading size="sm">Home location</Heading>
      </HStack>
      <Text fontSize="sm" color="fg.muted" mb={3}>
        New trips start from home by default, and parks can be ranked by distance from you.
      </Text>
      {home ? (
        <HStack justify="space-between" flexWrap="wrap" gap={2}>
          <Text fontSize="sm" fontWeight="600">{home.label}</Text>
          <Button size="xs" variant="outline" onClick={clear} loading={busy}>
            Forget home
          </Button>
        </HStack>
      ) : (
        <HStack flexWrap="wrap" gap={2}>
          <Input
            size="sm"
            maxW="240px"
            placeholder="City, state — e.g. Bozeman, MT"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) save({ place: draft.trim() });
            }}
          />
          <Button size="sm" colorPalette="pine" onClick={() => save({ place: draft.trim() })} disabled={!draft.trim()} loading={busy}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={useMyLocation} loading={busy}>
            <Icon mr={1}><LuLocateFixed /></Icon>
            Use my location
          </Button>
        </HStack>
      )}
      {error ? (
        <Text fontSize="xs" color="red.500" mt={2}>{error}</Text>
      ) : null}
    </Box>
  );
}
