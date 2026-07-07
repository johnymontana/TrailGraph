'use client';
import { useState } from 'react';
import { Badge, Button, Heading, HStack, Icon, Input, Text } from '@chakra-ui/react';
import { LuHouse, LuRepeat } from 'react-icons/lu';
import { decodeEntities } from '../../lib/html-entities';
import { useTripBuilder } from './useTripBuilder';

/**
 * The open trip's header: name/rename, the persistent alert-count badge (P1.2 — safety at a glance), a
 * compact live-metrics line (ADR-076: on mobile the map chip lives in a hidden pane, so the Itinerary
 * pane needs its own running total — deliberately WITHOUT the map chip's "<n> stop(s)" phrasing, which
 * stays exclusive to the chip so e2e text selectors never collide), and the trip-origin row (ADR-074).
 */
export function TripHeader() {
  const { trip, alerts, metrics, rename, setOrigin } = useTripBuilder();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingOrigin, setEditingOrigin] = useState(false);
  const [originDraft, setOriginDraft] = useState('');

  if (!trip) return null;

  async function saveName() {
    if (!nameDraft.trim()) return;
    // Close the editor only on success — a 429/500/network failure keeps it open so the typed draft
    // isn't silently discarded.
    if (await rename(nameDraft)) setEditingName(false);
  }
  async function saveOrigin(body: { place?: string; clearOrigin?: boolean; returnToOrigin?: boolean }) {
    const ok = await setOrigin(body);
    if (ok) {
      setEditingOrigin(false);
      setOriginDraft('');
    }
  }

  const hrs = (min: number | null | undefined) => (min == null ? null : Math.round((min / 60) * 10) / 10);

  return (
    <>
      {editingName ? (
        <HStack>
          <Input
            size="sm"
            fontSize={{ base: 'md', md: 'sm' }}
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
          <Button size="xs" colorPalette="pine" onClick={saveName}>Save</Button>
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
      {/* Compact running total (ADR-076): same TripMetrics the map chip renders, phrased without the
          chip's "<n> stop(s)" string. Gives the mobile typeahead-add same-pane feedback. */}
      {metrics && metrics.stops > 0 && (metrics.driveMiles > 0 || metrics.costTotal > 0 || metrics.darkHoursTotal != null) ? (
        <HStack gap={3} fontSize="xs" color="fg.muted" data-testid="trip-metrics-line">
          {metrics.driveMiles > 0 ? <Text>{Math.round(metrics.driveMiles)} mi · {hrs(metrics.driveMinutes)} h drive</Text> : null}
          {metrics.costTotal > 0 ? <Text>${metrics.costTotal} fees</Text> : null}
          {metrics.darkHoursTotal != null ? <Text>{Math.round(metrics.darkHoursTotal)} dark h</Text> : null}
        </HStack>
      ) : null}
      {/* Trip origin (ADR-074): defaults from the saved home location; editable per trip (fly-in trips),
          with a round-trip toggle that adds the drive home to the route. */}
      <HStack gap={2} flexWrap="wrap">
        <Icon color="trail.solid" boxSize={3.5}><LuHouse /></Icon>
        {editingOrigin ? (
          <>
            <Input
              size="xs"
              fontSize={{ base: 'md', md: 'xs' }}
              maxW="220px"
              autoFocus
              placeholder="Start from — e.g. Bozeman, MT"
              value={originDraft}
              onChange={(e) => setOriginDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && originDraft.trim() && saveOrigin({ place: originDraft.trim() })}
            />
            <Button size="xs" minH={{ base: '9', md: '6' }} colorPalette="pine" disabled={!originDraft.trim()} onClick={() => saveOrigin({ place: originDraft.trim() })}>
              Set
            </Button>
            <Button size="xs" minH={{ base: '9', md: '6' }} variant="ghost" onClick={() => setEditingOrigin(false)}>Cancel</Button>
          </>
        ) : trip.origin ? (
          <>
            <Text fontSize="xs">
              Starts from <Text as="span" fontWeight="600">{trip.origin.label ?? 'your start point'}</Text>
            </Text>
            <Button
              size="2xs"
              minH={{ base: '9', md: '5' }}
              variant={trip.returnToOrigin ? 'solid' : 'outline'}
              colorPalette="pine"
              title="Route back to the start at the end of the trip"
              onClick={() => saveOrigin({ returnToOrigin: !trip.returnToOrigin })}
            >
              <Icon boxSize={3}><LuRepeat /></Icon>
              Round trip{trip.returnToOrigin ? ': on' : ': off'}
            </Button>
            <Button size="2xs" minH={{ base: '9', md: '5' }} variant="ghost" onClick={() => { setOriginDraft(trip.origin?.label ?? ''); setEditingOrigin(true); }}>
              Change
            </Button>
            <Button size="2xs" minH={{ base: '9', md: '5' }} variant="ghost" colorPalette="red" onClick={() => saveOrigin({ clearOrigin: true })}>
              Clear
            </Button>
          </>
        ) : (
          <>
            <Text fontSize="xs" color="fg.muted">No start point — route begins at the first stop.</Text>
            <Button size="2xs" minH={{ base: '9', md: '5' }} variant="outline" onClick={() => setEditingOrigin(true)}>
              Set a start point
            </Button>
          </>
        )}
      </HStack>
    </>
  );
}
