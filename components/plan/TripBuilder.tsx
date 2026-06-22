'use client';
import { useEffect, useState } from 'react';
import { Box, Stack, Heading, Text, Input, Button, Flex, HStack, IconButton, Separator, Badge } from '@chakra-ui/react';
import { TripMap } from './TripMap';
import { ParkSearchInput } from './ParkSearchInput';

/** Itinerary builder (C1-C4) — drives the Trip service via /api/trips. Fully functional without the agent. */
interface Stop {
  id: string;
  order: number;
  parkName?: string;
  name?: string;
  lat?: number | null;
  lng?: number | null;
  driveTo?: { miles: number; minutes: number; source: string } | null;
}
interface Trip {
  id: string;
  name: string;
  stops: (Stop | null)[];
}

export function TripBuilder() {
  const [trips, setTrips] = useState<{ id: string; name: string; stops: number }[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [newName, setNewName] = useState('');
  const [alerts, setAlerts] = useState<{ park: string; alerts: { category: string; title: string }[] }[] | null>(null);
  const [dayMap, setDayMap] = useState<Record<string, number>>({});
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  async function loadTrips() {
    const res = await fetch('/api/trips');
    if (res.status === 401) return setErr('Sign in to plan trips.');
    const { trips } = await res.json();
    setTrips(trips ?? []);
  }
  useEffect(() => {
    loadTrips();
  }, []);

  // Live-refresh when the ranger saves a trip from the chat panel (R3 §4.2). ChatPanel dispatches this
  // with the new trip id so the sidebar updates — and we open it — without a reload.
  useEffect(() => {
    function onChanged(e: Event) {
      loadTrips();
      const id = (e as CustomEvent<{ tripId?: string }>).detail?.tripId;
      if (id) openTrip(id);
    }
    window.addEventListener('trailgraph:trips-changed', onChanged);
    return () => window.removeEventListener('trailgraph:trips-changed', onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openTrip(id: string) {
    if (trip?.id === id) return; // idempotent: re-clicking the open trip is a no-op, never deselects (§4.6)
    const res = await fetch(`/api/trips/${id}`);
    const { trip: opened } = await res.json();
    setTrip(opened);
    setAlerts(null);
    setDayMap({});
    setEditingName(false);
  }

  async function rename() {
    if (!trip || !nameDraft.trim()) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'rename', name: nameDraft.trim() }),
    });
    const { trip: updated } = await res.json();
    if (updated) {
      setTrip(updated);
      setEditingName(false);
      loadTrips();
    }
  }
  async function create() {
    if (!newName.trim()) return;
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (res.status === 401) return setErr('Sign in to plan trips.');
    const { id } = await res.json();
    setNewName('');
    await loadTrips();
    await openTrip(id);
  }
  async function addPark(code: string) {
    if (!trip || !code) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'addStop', stop: { kind: 'park', refId: code } }),
    });
    const { trip: updated } = await res.json();
    if (updated) {
      setTrip(updated);
      loadTrips(); // refresh the sidebar stop counts (§2.14)
    }
  }
  async function removeStop(stopId: string) {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'removeStop', stopId }),
    });
    const { trip: updated } = await res.json();
    if (updated) {
      setTrip(updated);
      loadTrips(); // refresh the sidebar stop counts (§2.14)
    }
  }
  async function checkAlerts() {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'alerts' }),
    });
    const { alerts } = await res.json();
    setAlerts(alerts ?? []);
  }
  async function share() {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'read' }),
    });
    if (res.ok) {
      const { url } = (await res.json()) as { url: string };
      setShareUrl(`${window.location.origin}${url}`);
    }
  }
  async function optimizeRoute() {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'optimize' }),
    });
    const { trip: updated } = await res.json();
    if (updated) {
      setTrip(updated);
      setDayMap({});
    }
  }
  async function suggestDayPlan() {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'suggestDays' }),
    });
    const { days } = (await res.json()) as { days: { id: string; day: number }[] };
    setDayMap(Object.fromEntries((days ?? []).map((d) => [d.id, d.day])));
  }

  if (err) return <Box p={4}><Text color="fg.muted">{err}</Text></Box>;

  const stops = (trip?.stops ?? []).filter(Boolean) as Stop[];

  return (
    <Stack p={4} gap={4} h="100%" overflowY="auto">
      <Heading size="md">Trips</Heading>
      <Flex gap={2}>
        <Input size="sm" placeholder="New trip name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button size="sm" onClick={create} colorPalette="blue">Create</Button>
      </Flex>
      <HStack wrap="wrap">
        {trips.map((t) => (
          <Button key={t.id} size="xs" variant={trip?.id === t.id ? 'solid' : 'outline'} onClick={() => openTrip(t.id)}>
            {t.name} ({t.stops})
          </Button>
        ))}
      </HStack>

      {trip ? (
        <>
          <Separator />
          {editingName ? (
            <HStack>
              <Input
                size="sm"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && rename()}
              />
              <Button size="xs" colorPalette="blue" onClick={rename}>Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
            </HStack>
          ) : (
            <HStack>
              <Heading size="sm">{trip.name}</Heading>
              <Button
                size="xs"
                variant="ghost"
                aria-label="Rename trip"
                onClick={() => {
                  setNameDraft(trip.name);
                  setEditingName(true);
                }}
              >
                Rename
              </Button>
            </HStack>
          )}
          <ParkSearchInput onSelect={addPark} />
          {stops.some((s) => s.lat != null && s.lng != null) ? (
            <TripMap
              stops={stops.map((s) => ({ lat: s.lat ?? null, lng: s.lng ?? null, label: s.parkName ?? s.name ?? 'Stop', order: s.order }))}
            />
          ) : null}

          <Stack gap={1}>
            {stops.map((s, i) => {
              const day = dayMap[s.id];
              const prevDay = i > 0 ? dayMap[stops[i - 1].id] : undefined;
              return (
                <Box key={s.id}>
                  {day && day !== prevDay ? (
                    <Text fontSize="xs" fontWeight="bold" color="blue.600" mt={2}>
                      Day {day}
                    </Text>
                  ) : null}
                  <HStack>
                    <Text fontSize="sm" flex="1">
                      {i + 1}. {s.parkName ?? s.name ?? 'Stop'}
                    </Text>
                    <IconButton size="xs" variant="ghost" aria-label={`Remove ${s.parkName ?? s.name ?? 'stop'}`} onClick={() => removeStop(s.id)}>
                      ✕
                    </IconButton>
                  </HStack>
                  {s.driveTo ? (
                    <Text fontSize="xs" color="fg.muted" pl={4}>
                      ↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min
                      {s.driveTo.source === 'great_circle' ? ' (approx)' : ''}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
          {stops.length > 0 ? (
            <Stack gap={2}>
              <HStack wrap="wrap">
                <Button size="sm" variant="outline" onClick={checkAlerts}>
                  Check alerts
                </Button>
                <Button size="sm" variant="outline" onClick={suggestDayPlan}>
                  Suggest day plan
                </Button>
                <Button size="sm" variant="outline" onClick={optimizeRoute}>
                  Optimize route
                </Button>
                <Button size="sm" variant="outline" onClick={share}>
                  Share
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/trips/${trip.id}/ics`}>Export .ics</a>
                </Button>
              </HStack>
              {shareUrl ? (
                <Text fontSize="xs" color="fg.muted">
                  Read-only link: <Text as="span" color="blue.600">{shareUrl}</Text>
                </Text>
              ) : null}
            </Stack>
          ) : null}
          {alerts ? (
            alerts.length === 0 ? (
              <Text fontSize="sm" color="green.600">No active Closure/Danger alerts. ✓</Text>
            ) : (
              <Stack gap={1}>
                {alerts.map((a, i) => (
                  <Box key={i}>
                    <Text fontSize="sm" fontWeight="semibold">{a.park}</Text>
                    {a.alerts.map((al, j) => (
                      <HStack key={j}>
                        <Badge colorPalette={al.category === 'Danger' ? 'red' : 'orange'}>{al.category}</Badge>
                        <Text fontSize="xs">{al.title}</Text>
                      </HStack>
                    ))}
                  </Box>
                ))}
              </Stack>
            )
          ) : null}
        </>
      ) : (
        <Text color="fg.muted" fontSize="sm">Create or select a trip to start building an itinerary.</Text>
      )}
    </Stack>
  );
}
