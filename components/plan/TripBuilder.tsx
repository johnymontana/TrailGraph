'use client';
import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Heading, Text, Input, Button, Flex, HStack, IconButton, Separator, Badge, Icon } from '@chakra-ui/react';
import { Reorder } from 'motion/react';
import { LuX, LuGripVertical, LuFootprints, LuTriangleAlert, LuTentTree } from 'react-icons/lu';
import { MapTripCanvas } from './MapTripCanvas';
import { ParkSearchInput } from './ParkSearchInput';
import { toast } from '../../lib/toast';
import { TripDashboardCard } from '../conditions/ConditionCards';
import { AlertList } from '../chat/Cards';
import { decodeEntities } from '../../lib/html-entities';
import { tripDayLoads } from '../../lib/itinerary';
import type { TripDashboard } from '../../lib/conditions';
import type { TripMetrics } from '../../lib/trip-lab';

/** Itinerary builder (C1-C4) — drives the Trip service via /api/trips. Fully functional without the agent. */
interface TripHike {
  id: string;
  name: string;
  lengthMiles?: number | null;
  estTimeHrs?: number | null;
  difficulty?: string | null;
  permitRequired?: boolean;
}

interface Stop {
  id: string;
  order: number;
  day?: number | null;
  parkCode?: string | null;
  parkName?: string;
  campgroundName?: string;
  poiTitle?: string;
  placeTitle?: string;
  name?: string;
  lat?: number | null;
  lng?: number | null;
  hikes?: TripHike[];
  lodging?: { id: string; name: string; feeUSD?: number | null; reservationUrl?: string | null } | null;
  driveTo?: { miles: number; minutes: number; source: string } | null;
}

/** Display label for any stop kind (park / campground / POI / place / custom). */
const stopLabel = (s: Stop): string =>
  s.parkName ?? s.placeTitle ?? s.campgroundName ?? s.poiTitle ?? s.name ?? 'Stop';
interface Trip {
  id: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  stops: (Stop | null)[];
}

export function TripBuilder() {
  const [trips, setTrips] = useState<{ id: string; name: string; stops: number }[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [newName, setNewName] = useState('');
  const [alerts, setAlerts] = useState<{ park: string; alerts: { category: string; title: string }[] }[] | null>(null);
  const [cost, setCost] = useState<{
    perPark: { parkCode: string; parkName: string; fee: number }[];
    total: number;
    atbPrice: number;
    holdsAtb: boolean;
    atbSaves: boolean;
  } | null>(null);
  const [costErr, setCostErr] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<TripDashboard | null>(null);
  // Live running-total badge for the build-on-map canvas (#9): updated from every mutation response.
  const [metrics, setMetrics] = useState<TripMetrics | null>(null);
  // A local copy of the stops the drag-reorder list mutates live (motion/react Reorder owns its values array);
  // synced from `trip` on every change and persisted on drop.
  const [localStops, setLocalStops] = useState<Stop[]>([]);
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
    // Deep-link: /plan?trip=<id> opens that trip (used by "Start a trip from this tour" on park pages).
    const id = new URLSearchParams(window.location.search).get('trip');
    if (id) openTrip(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Broadcast the open trip's id + dates to the ranger chat (P2.1). ChatPanel attaches them as ephemeral
  // Eve client context on every send, so dated dark-sky/astro/best-time answers reflect the trip window
  // (the best night in it) instead of "tonight". Fires on open/create/rename/deselect (all call setTrip).
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('trailgraph:active-trip', {
        detail: trip
          ? { id: trip.id, name: trip.name, startDate: trip.startDate ?? null, endDate: trip.endDate ?? null }
          : null,
      }),
    );
  }, [trip?.id, trip?.name, trip?.startDate, trip?.endDate]);

  // Keep the drag-reorder list in lockstep with the open trip's stops (after any add/remove/reorder/optimize).
  useEffect(() => {
    setLocalStops((trip?.stops ?? []).filter(Boolean) as Stop[]);
  }, [trip]);

  // Every stop mutation returns the fresh trip + live metrics (#9) — apply both, invalidate the now-stale
  // cost card, and refresh the sidebar stop counts. Shared by the canvas, search-add, remove, and reorder.
  function applyMutation(data: { trip?: Trip | null; metrics?: TripMetrics | null }) {
    if (data.trip) setTrip(data.trip);
    // Keep the prior badge if metrics recompute transiently failed (null) — don't blink it off (#9 LOW-4).
    setMetrics((prev) => data.metrics ?? prev);
    setCost(null);
    setCostErr(null);
    loadTrips();
  }

  async function openTrip(id: string) {
    if (trip?.id === id) return; // idempotent: re-clicking the open trip is a no-op, never deselects (§4.6)
    const res = await fetch(`/api/trips/${id}?include=metrics`);
    const { trip: opened, metrics: m } = await res.json();
    setTrip(opened);
    setMetrics(m ?? null);
    setAlerts(null);
    setCost(null);
    setCostErr(null);
    setDashboard(null);
    setDayMap({});
    setEditingName(false);
    // Auto-load Closure/Danger alerts on open so safety items pin to the trip artifact without an extra
    // click (P1.2). openTrip is idempotent (early-returns on the same id), so this never loops.
    fetch(`/api/trips/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'alerts' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.alerts)) setAlerts(d.alerts);
      })
      .catch(() => {});
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
  // All trip mutations share one 30/60s `tripmut` budget server-side (ORS cost); the canvas can exhaust it,
  // so every edit path surfaces a 429 the same way instead of silently no-opping (#9 LOW-1).
  function rateLimited(res: Response): boolean {
    if (res.status !== 429) return false;
    toast.info('Slow down — too many trip edits. Try again in a moment.');
    return true;
  }
  async function addPark(code: string) {
    if (!trip || !code) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'addStop', stop: { kind: 'park', refId: code } }),
    });
    if (rateLimited(res)) return;
    if (res.ok) applyMutation(await res.json());
  }
  async function removeStop(stopId: string) {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'removeStop', stopId }),
    });
    if (rateLimited(res)) return;
    if (res.ok) applyMutation(await res.json());
  }
  // Detach a hike from a stop (ADR-071) — `(:Stop)-[:INCLUDES_TRAIL]->(:Trail)`. Adding hikes happens via the
  // ranger or a trail page; the builder shows them and lets you drop one.
  async function removeHike(stopId: string, trailId: string) {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'excludeTrail', stopId, trailId }),
    });
    if (rateLimited(res)) return;
    if (res.ok) applyMutation(await res.json());
  }
  // Detach lodging from a stop (Campgrounds feature) — `(:Stop)-[:STAYS_AT]->(:Campground)`. Adding lodging
  // happens via the ranger or the campground detail page; the builder shows it and lets you drop it.
  async function removeLodging(stopId: string, campgroundId: string) {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'excludeCampground', stopId, campgroundId }),
    });
    if (rateLimited(res)) return;
    if (res.ok) applyMutation(await res.json());
  }
  // Persist a drag-reorder on drop (#9). Skip the round-trip if the order didn't actually change. The 30/60s
  // trip-mutation cap is server-side; a 429 surfaces as a toast and the next openTrip resyncs the true order.
  async function persistReorder() {
    if (!trip) return;
    const ids = localStops.map((s) => s.id);
    const current = ((trip.stops ?? []).filter(Boolean) as Stop[]).map((s) => s.id);
    if (ids.length !== current.length || ids.every((id, i) => id === current[i])) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'reorder', orderedStopIds: ids }),
    });
    if (rateLimited(res)) {
      setLocalStops((trip.stops ?? []).filter(Boolean) as Stop[]); // revert the optimistic drag order
      return;
    }
    if (res.ok) {
      setDayMap({}); // the route order changed → the prior day grouping no longer maps cleanly (#9 LOW-2)
      applyMutation(await res.json());
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
  async function checkCost() {
    if (!trip) return;
    try {
      setCost(null);
      setCostErr(null);
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'cost' }),
      });
      if (!res.ok) {
        setCost(null);
        setCostErr('Failed to estimate trip cost. Please try again.');
        return;
      }
      const { cost } = await res.json();
      setCost(cost ?? null);
      setCostErr(null);
    } catch {
      setCost(null);
      setCostErr('Network error. Please try again.');
    }
  }
  async function checkConditions() {
    if (!trip) return;
    setDashboard(null);
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'conditions' }),
    });
    if (!res.ok) {
      toast.error('Could not load trip conditions.');
      return;
    }
    const { dashboard } = (await res.json()) as { dashboard: TripDashboard | null };
    setDashboard(dashboard);
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
      const full = `${window.location.origin}${url}`;
      setShareUrl(full);
      let copied = false;
      if (navigator.clipboard?.writeText) {
        copied = await navigator.clipboard.writeText(full).then(() => true).catch(() => false);
      }
      if (copied) {
        toast.success('Share link copied', 'A read-only link to this trip is on your clipboard.');
      } else {
        toast.success('Share link ready', 'Copy the read-only link shown below.');
      }
    } else {
      toast.error("Couldn't create share link", 'Please try again in a moment.');
    }
  }
  async function optimizeRoute() {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'optimize' }),
    });
    if (rateLimited(res)) return;
    if (res.ok) {
      const data = await res.json();
      if (data.trip) setDayMap({}); // route changed → the prior day grouping no longer maps cleanly
      applyMutation(data);
    }
  }
  // Trip Lab (ADR-056): fork the open trip into a copy and switch to it, leaving the original untouched.
  async function fork() {
    if (!trip) return;
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'fork' }),
    });
    if (!res.ok) {
      toast.error("Couldn't fork this trip", 'Please try again in a moment.');
      return;
    }
    const { tripId, trip: forked } = await res.json();
    await loadTrips();
    if (forked) {
      setTrip(forked);
      setAlerts(null);
      setCost(null);
      setCostErr(null);
      setDashboard(null);
      setDayMap({});
    } else if (tripId) {
      await openTrip(tripId);
    }
    toast.success('Trip forked', 'Editing the copy — your original is untouched.');
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
  // Memoize the canvas props keyed on `trip` (not on every render) — otherwise typing in the name box would
  // hand MapTripCanvas fresh array identities each keystroke and restart its route-draw animation (#9 MEDIUM-1).
  const canvasStops = useMemo(
    () => ((trip?.stops ?? []).filter(Boolean) as Stop[]).map((s) => ({ lat: s.lat ?? null, lng: s.lng ?? null, label: stopLabel(s), order: s.order })),
    [trip],
  );
  const addedParkCodes = useMemo(
    () => ((trip?.stops ?? []).filter(Boolean) as Stop[]).map((s) => s.parkCode).filter((code): code is string => !!code),
    [trip],
  );
  // Schedule-aware "over-packed day" warning (ADR-071): aggregate each day's hike hours + drive hours and
  // flag the days over ~8 h. Uses dayMap (Suggest day plan) or the stop's persisted day; empty until days exist.
  const overPackedDays = useMemo(() => {
    const loadStops = ((trip?.stops ?? []).filter(Boolean) as Stop[]).map((s) => ({
      day: dayMap[s.id] ?? s.day ?? null,
      driveMinutesToHere: s.driveTo?.minutes ?? 0,
      hikeMiles: (s.hikes ?? []).reduce((m, h) => m + (h.lengthMiles ?? 0), 0),
      hikeHours: (s.hikes ?? []).reduce((m, h) => m + (h.estTimeHrs ?? 0), 0),
    }));
    return tripDayLoads(loadStops).filter((d) => d.overPacked);
  }, [trip, dayMap]);

  return (
    <Stack p={4} gap={4} h="100%" overflowY="auto">
      <Heading size="md">Trips</Heading>
      <Flex gap={2}>
        <Input size="sm" placeholder="New trip name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button size="sm" onClick={create} colorPalette="pine">Create</Button>
      </Flex>
      <HStack wrap="wrap">
        {trips.map((t) => (
          <Button key={t.id} size="xs" variant={trip?.id === t.id ? 'solid' : 'outline'} onClick={() => openTrip(t.id)}>
            {decodeEntities(t.name)} ({t.stops})
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
              <Button size="xs" colorPalette="pine" onClick={rename}>Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
            </HStack>
          ) : (
            <HStack>
              <Heading size="sm">{decodeEntities(trip.name)}</Heading>
              {(() => {
                // Persistent alert-count badge on the trip header (P1.2) so safety items are visible at a glance.
                const n = alerts ? alerts.reduce((sum, a) => sum + a.alerts.length, 0) : 0;
                return n > 0 ? (
                  <Badge colorPalette="red" variant="solid" title="Active Closure/Danger alerts">
                    {n} alert{n === 1 ? '' : 's'}
                  </Badge>
                ) : null;
              })()}
              <Button
                size="xs"
                variant="ghost"
                aria-label="Rename trip"
                onClick={() => {
                  setNameDraft(decodeEntities(trip.name));
                  setEditingName(true);
                }}
              >
                Rename
              </Button>
            </HStack>
          )}
          <ParkSearchInput onSelect={addPark} />
          {/* Build-on-map canvas (#9): click a park to add it; the route + running total assemble live. */}
          <Box h="380px" w="full" borderRadius="md" overflow="hidden">
            <MapTripCanvas
              tripId={trip.id}
              stops={canvasStops}
              addedParkCodes={addedParkCodes}
              metrics={metrics}
              onMutated={(d) => applyMutation({ trip: d.trip as unknown as Trip | null, metrics: d.metrics })}
            />
          </Box>

          {/* Drag a stop to reorder (#9); the route + drive times recompute on drop. Day headers ride inside
              each item so they stay direct children of the Reorder.Group. */}
          <Reorder.Group axis="y" values={localStops} onReorder={setLocalStops} as="div" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 0, margin: 0 }}>
            {localStops.map((s, i) => {
              const day = dayMap[s.id];
              const prevDay = i > 0 ? dayMap[localStops[i - 1].id] : undefined;
              return (
                <Reorder.Item key={s.id} value={s} as="div" onDragEnd={persistReorder} style={{ listStyle: 'none' }}>
                  {day && day !== prevDay ? (
                    <Text fontSize="xs" fontWeight="bold" color="brand.fg" mt={2}>
                      Day {day}
                    </Text>
                  ) : null}
                  <HStack>
                    <Icon color="fg.muted" cursor="grab" boxSize={3.5} aria-label="Drag to reorder">
                      <LuGripVertical />
                    </Icon>
                    <Text fontSize="sm" flex="1">
                      {i + 1}. {stopLabel(s)}
                    </Text>
                    <IconButton size="xs" variant="ghost" colorPalette="red" aria-label={`Remove ${stopLabel(s)}`} onClick={() => removeStop(s.id)}>
                      <LuX />
                    </IconButton>
                  </HStack>
                  {s.driveTo ? (
                    <Text fontSize="xs" color="fg.muted" pl={4}>
                      ↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min
                      {s.driveTo.source === 'great_circle' ? ' (approx)' : ''}
                    </Text>
                  ) : null}
                  {/* Hikes nested under this park stop (ADR-071) — add via the ranger or a trail page; remove here. */}
                  {s.hikes?.length ? (
                    <Stack gap={0.5} pl={4} mt={1}>
                      <Text fontSize="2xs" fontWeight="bold" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
                        Hikes here
                      </Text>
                      {s.hikes.map((h) => (
                        <HStack key={h.id} gap={1.5}>
                          <Icon color="pine.solid" boxSize={3}><LuFootprints /></Icon>
                          <Text fontSize="xs" flex="1" lineClamp={1}>
                            {h.name}
                            {h.lengthMiles != null || h.estTimeHrs != null ? (
                              <Text as="span" color="fg.muted">
                                {' '}· {[h.lengthMiles != null ? `${h.lengthMiles} mi` : null, h.estTimeHrs != null ? `~${h.estTimeHrs} hr` : null].filter(Boolean).join(' · ')}
                              </Text>
                            ) : null}
                          </Text>
                          {h.permitRequired ? <Badge size="xs" colorPalette="orange">permit</Badge> : null}
                          <IconButton size="2xs" variant="ghost" colorPalette="red" aria-label={`Remove ${h.name}`} onClick={() => removeHike(s.id, h.id)}>
                            <LuX />
                          </IconButton>
                        </HStack>
                      ))}
                    </Stack>
                  ) : null}
                  {/* Lodging nested under this stop (Campgrounds feature) — add via the ranger or a campground page; remove here. */}
                  {s.lodging ? (
                    <Stack gap={0.5} pl={4} mt={1}>
                      <Text fontSize="2xs" fontWeight="bold" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
                        Sleeping here
                      </Text>
                      <HStack gap={1.5}>
                        <Icon color="trail.solid" boxSize={3}><LuTentTree /></Icon>
                        <Text fontSize="xs" flex="1" lineClamp={1}>
                          {s.lodging.name}
                          {s.lodging.feeUSD != null ? <Text as="span" color="fg.muted"> · ${s.lodging.feeUSD}/night</Text> : null}
                        </Text>
                        <IconButton size="2xs" variant="ghost" colorPalette="red" aria-label={`Remove ${s.lodging.name}`} onClick={() => removeLodging(s.id, s.lodging!.id)}>
                          <LuX />
                        </IconButton>
                      </HStack>
                    </Stack>
                  ) : null}
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
          {overPackedDays.length ? (
            <Box borderWidth="1px" borderColor="orange.emphasized" bg="orange.subtle" borderRadius="l2" p={3}>
              <HStack gap={2} align="start">
                <Icon color="orange.fg" mt={0.5} flexShrink={0}><LuTriangleAlert /></Icon>
                <Box>
                  <Text fontSize="sm" fontWeight="semibold" color="orange.fg">
                    Heavy day{overPackedDays.length > 1 ? 's' : ''}
                  </Text>
                  {overPackedDays.map((d) => (
                    <Text key={d.day} fontSize="xs" color="orange.fg">
                      Day {d.day}: {d.hikeMiles} mi hiking{d.hikeHours ? ` (~${d.hikeHours} hr)` : ''}
                      {d.driveHours ? ` + ${d.driveHours}-hr drive` : ''} — consider splitting it.
                    </Text>
                  ))}
                </Box>
              </HStack>
            </Box>
          ) : null}
          {stops.length > 0 ? (
            <Stack gap={2}>
              <HStack wrap="wrap">
                <Button size="sm" variant="outline" onClick={checkAlerts}>
                  Check alerts
                </Button>
                <Button size="sm" variant="outline" onClick={checkCost}>
                  Trip cost
                </Button>
                <Button size="sm" variant="outline" onClick={checkConditions}>
                  Trip conditions
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
                <Button size="sm" variant="outline" onClick={fork}>
                  Fork
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/trips/${trip.id}/brief`} target="_blank" rel="noopener noreferrer">Field brief</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/trips/${trip.id}/offline`}>Offline pack</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/trips/${trip.id}/ics`}>Export .ics</a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`/api/trips/${trip.id}/gpx`}>Export .gpx</a>
                </Button>
              </HStack>
              {shareUrl ? (
                <Text fontSize="xs" color="fg.muted">
                  Read-only link: <Text as="span" color="brand.fg">{shareUrl}</Text>
                </Text>
              ) : null}
            </Stack>
          ) : null}
          {/* Structured, shared alert card (P1.2) — same component the chat uses, instead of a bespoke list. */}
          {alerts ? <AlertList data={{ parks: alerts }} /> : null}
          {cost ? (
            <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={3}>
              <HStack mb={1}>
                <Text fontWeight="semibold" flex="1">Estimated entrance fees</Text>
                <Text fontWeight="bold">${cost.total.toFixed(0)}</Text>
              </HStack>
              {cost.holdsAtb ? (
                <Text fontSize="xs" color="green.fg">
                  Covered by your America the Beautiful annual pass. ✓
                </Text>
              ) : cost.atbSaves ? (
                <Text fontSize="xs" color="fg.muted">
                  The ${cost.atbPrice} America the Beautiful annual pass would save you ${(cost.perPark.reduce((s, p) => s + p.fee, 0) - cost.atbPrice).toFixed(0)} here.
                </Text>
              ) : (
                <Text fontSize="xs" color="fg.muted">Per-vehicle entrance fees, summed across your parks.</Text>
              )}
            </Box>
          ) : null}
          {costErr ? <Text fontSize="sm" color="red.fg">{costErr}</Text> : null}
          {dashboard ? (
            dashboard.stops.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">Add a park stop to see its conditions.</Text>
            ) : (
              <TripDashboardCard data={dashboard as unknown as Record<string, unknown>} />
            )
          ) : null}
        </>
      ) : (
        <Text color="fg.muted" fontSize="sm">Create or select a trip to start building an itinerary.</Text>
      )}
    </Stack>
  );
}
