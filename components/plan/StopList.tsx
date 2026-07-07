'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Stack, Text, HStack, IconButton, Badge, Icon } from '@chakra-ui/react';
import { Reorder, useDragControls } from 'motion/react';
import { LuX, LuGripVertical, LuFootprints, LuTentTree, LuChevronUp, LuChevronDown, LuTriangleAlert } from 'react-icons/lu';
import { tripDayLoads, type DayLoad } from '../../lib/itinerary';
import { useTripBuilder, stopLabel, touchTarget, type Stop } from './useTripBuilder';

/**
 * One draggable stop row. Drag starts ONLY from the grip handle (`dragListener={false}` + drag controls):
 * motion's default whole-row listener hijacked the pane's one-finger scroll on touch — the handle is the
 * standard fix, and `touch-action:none` on it lets the drag claim the gesture before the browser scrolls.
 * Up/Down buttons are the KEYBOARD-accessible reorder path (P3.3) — motion's Reorder is pointer-only.
 */
function StopItem({
  stop: s,
  index: i,
  count,
  day,
  showDay,
  dayLoad,
  onDragStart,
  onDragEnd,
  onMove,
  onRemove,
  onRemoveHike,
  onRemoveLodging,
}: {
  stop: Stop;
  index: number;
  count: number;
  day?: number;
  showDay: boolean;
  dayLoad?: DayLoad;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (stopId: string, dir: 'up' | 'down') => void;
  onRemove: (stopId: string) => void;
  onRemoveHike: (stopId: string, trailId: string) => void;
  onRemoveLodging: (stopId: string, campgroundId: string) => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={s} as="div" dragListener={false} dragControls={controls} onDragStart={onDragStart} onDragEnd={onDragEnd} style={{ listStyle: 'none' }}>
      {/* Day-section header (P3.4): a bordered band with the per-day load chip (hike + drive hours), instead
          of a bare "Day N". Rides inside the item so items stay direct Reorder.Group children. */}
      {showDay ? (
        <HStack
          mt={i === 0 ? 0 : 3}
          mb={1}
          gap={2}
          px={2}
          py={1}
          borderRadius="md"
          bg={dayLoad?.overPacked ? 'orange.subtle' : 'bg.muted'}
          borderWidth="1px"
          borderColor={dayLoad?.overPacked ? 'orange.emphasized' : 'border'}
        >
          <Text fontSize="xs" fontWeight="bold" color={dayLoad?.overPacked ? 'orange.fg' : 'brand.fg'}>Day {day}</Text>
          {dayLoad ? (
            <Text fontSize="2xs" color={dayLoad.overPacked ? 'orange.fg' : 'fg.muted'} flex="1">
              {[dayLoad.hikeHours ? `${dayLoad.hikeHours} h hiking` : null, dayLoad.driveHours ? `${dayLoad.driveHours} h drive` : null].filter(Boolean).join(' · ') || 'light day'}
            </Text>
          ) : null}
          {dayLoad?.overPacked ? <Icon color="orange.fg" boxSize={3.5}><LuTriangleAlert /></Icon> : null}
        </HStack>
      ) : null}
      <HStack gap={1} minH={{ base: '11', md: 'auto' }}>
        <IconButton
          size="xs"
          variant="ghost"
          color="fg.muted"
          aria-label={`Drag to reorder ${stopLabel(s)}`}
          {...touchTarget}
          cursor="grab"
          _active={{ cursor: 'grabbing' }}
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            e.preventDefault(); // don't let the press select text or start a scroll before the drag claims it
            controls.start(e);
          }}
        >
          <LuGripVertical />
        </IconButton>
        <Text fontSize="sm" flex="1">
          {i + 1}. {stopLabel(s)}
        </Text>
        {/* Keyboard-accessible reorder (P3.3): compact up/down, disabled at the ends. */}
        <IconButton size="2xs" variant="ghost" color="fg.muted" aria-label={`Move ${stopLabel(s)} up`} minW={{ base: '9', md: '5' }} minH={{ base: '9', md: '5' }} disabled={i === 0} onClick={() => onMove(s.id, 'up')}>
          <LuChevronUp />
        </IconButton>
        <IconButton size="2xs" variant="ghost" color="fg.muted" aria-label={`Move ${stopLabel(s)} down`} minW={{ base: '9', md: '5' }} minH={{ base: '9', md: '5' }} disabled={i === count - 1} onClick={() => onMove(s.id, 'down')}>
          <LuChevronDown />
        </IconButton>
        <IconButton size="xs" variant="ghost" colorPalette="red" aria-label={`Remove ${stopLabel(s)}`} {...touchTarget} onClick={() => onRemove(s.id)}>
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
              <IconButton size="2xs" variant="ghost" colorPalette="red" aria-label={`Remove ${h.name}`} minW={{ base: '9', md: '5' }} minH={{ base: '9', md: '5' }} onClick={() => onRemoveHike(s.id, h.id)}>
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
            <IconButton size="2xs" variant="ghost" colorPalette="red" aria-label={`Remove ${s.lodging.name}`} minW={{ base: '9', md: '5' }} minH={{ base: '9', md: '5' }} onClick={() => onRemoveLodging(s.id, s.lodging!.id)}>
              <LuX />
            </IconButton>
          </HStack>
        </Stack>
      ) : null}
    </Reorder.Item>
  );
}

/**
 * The draggable stop list + the origin drive legs around it (ADR-074: the origin is not a stop, so its
 * legs render outside the Reorder.Group). Owns motion's live values array (`localStops`) locally — it's
 * pure drag state — and reports drag start/end to the provider so a ranger refresh landing mid-drag is
 * stashed instead of yanking the rows (ADR-076); a stash applied on drop wins over the stale drag order.
 * Keyboard reorder (P3.3) and per-day load chips (P3.4) layer on top.
 */
export function StopList() {
  const { trip, dayMap, removeStop, removeHike, removeLodging, persistReorder, moveStop, beginDrag, endDrag } = useTripBuilder();
  // A local copy of the stops the drag-reorder list mutates live (motion/react Reorder owns its values
  // array); synced from `trip` on every change and persisted on drop.
  const [localStops, setLocalStops] = useState<Stop[]>([]);
  // Current trip, read at drop time (not the render closure) so a 429 revert restores the LATEST server
  // order — e.g. if a ranger refresh landed during the in-flight reorder POST.
  const tripRef = useRef(trip);
  tripRef.current = trip;
  useEffect(() => {
    setLocalStops(((trip?.stops ?? []).filter(Boolean) as Stop[]));
  }, [trip]);

  // Per-day loads for the section-header chips (P3.4). Keyed by day number; empty until a plan exists.
  const dayLoadByDay = useMemo(() => {
    const loads = tripDayLoads(
      localStops.map((s) => ({
        day: dayMap[s.id] ?? s.day ?? null,
        driveMinutesToHere: s.driveTo?.minutes ?? 0,
        hikeMiles: (s.hikes ?? []).reduce((m, h) => m + (h.lengthMiles ?? 0), 0),
        hikeHours: (s.hikes ?? []).reduce((m, h) => m + (h.estTimeHrs ?? 0), 0),
      })),
    );
    return new Map(loads.map((d) => [d.day, d]));
  }, [localStops, dayMap]);

  if (!trip) return null;

  async function handleDragEnd() {
    if (endDrag()) return; // a ranger refresh landed mid-drag — the fresh trip already replaced the list
    const result = await persistReorder(localStops.map((s) => s.id));
    if (result === 'limited') setLocalStops(((tripRef.current?.stops ?? []).filter(Boolean) as Stop[])); // revert to the latest server order
  }

  return (
    <>
      {/* First leg: home/origin → stop 1 (the origin is not a draggable stop, so it renders above the list). */}
      {trip.origin && trip.originLeg && localStops.length > 0 ? (
        <Text fontSize="xs" color="fg.muted">
          ⌂ {trip.origin.label ?? 'Start'} ↓ {Math.round(trip.originLeg.miles)} mi · {Math.round(trip.originLeg.minutes)} min
          {trip.originLeg.source === 'great_circle' ? ' (approx)' : ''}
        </Text>
      ) : null}
      {/* Drag a stop to reorder (#9) — from the grip handle only (see StopItem); the route + drive times
          recompute on drop. Day headers ride inside each item so they stay direct children of the
          Reorder.Group. Day falls back to the stop's PERSISTED `day` (not just the suggest-days map). */}
      <Reorder.Group axis="y" values={localStops} onReorder={setLocalStops} as="div" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 0, margin: 0 }}>
        {localStops.map((s, i) => {
          const day = dayMap[s.id] ?? s.day ?? undefined;
          const prevDay = i > 0 ? dayMap[localStops[i - 1].id] ?? localStops[i - 1].day ?? undefined : undefined;
          return (
            <StopItem
              key={s.id}
              stop={s}
              index={i}
              count={localStops.length}
              day={day}
              showDay={day != null && day !== prevDay}
              dayLoad={day != null ? dayLoadByDay.get(day) : undefined}
              onDragStart={beginDrag}
              onDragEnd={handleDragEnd}
              onMove={moveStop}
              onRemove={removeStop}
              onRemoveHike={removeHike}
              onRemoveLodging={removeLodging}
            />
          );
        })}
      </Reorder.Group>
      {/* Return leg: last stop → home (round trip). */}
      {trip.origin && trip.returnToOrigin && trip.returnLeg && localStops.length > 0 ? (
        <Text fontSize="xs" color="fg.muted">
          ↓ {Math.round(trip.returnLeg.miles)} mi · {Math.round(trip.returnLeg.minutes)} min back to ⌂ {trip.origin.label ?? 'start'}
          {trip.returnLeg.source === 'great_circle' ? ' (approx)' : ''}
        </Text>
      ) : null}
      {/* Empty-trip checklist (P3.5): a just-created trip has no stops yet — show the three add paths. */}
      {localStops.length === 0 ? (
        <Box borderWidth="1px" borderStyle="dashed" borderColor="border" borderRadius="l2" p={4}>
          <Text fontSize="sm" fontWeight="semibold" mb={1}>This trip is empty — add your first stop:</Text>
          <Stack gap={0.5} fontSize="sm" color="fg.muted">
            <Text>• Search a park by name above</Text>
            <Text>• Tap a park dot on the map</Text>
            <Text>• Ask the ranger to plan it for you</Text>
          </Stack>
        </Box>
      ) : null}
    </>
  );
}
