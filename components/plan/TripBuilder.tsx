'use client';
import { Box, Button, Stack, Heading, Text, HStack, Icon, Separator } from '@chakra-ui/react';
import { LuTriangleAlert, LuMapPinned, LuSparkles } from 'react-icons/lu';
import { EmptyState } from '../ui/empty-state';
import { requestPlanPane } from './plan-events';
import { ParkSearchInput } from './ParkSearchInput';
import { TripSwitcher } from './TripSwitcher';
import { TripHeader } from './TripHeader';
import { StopList } from './StopList';
import { TripActions } from './TripActions';
import { TripInsights } from './TripInsights';
import { useTripBuilder } from './useTripBuilder';

/**
 * Itinerary builder (C1-C4) — the ONE itinerary-pane composition, used at every breakpoint (ADR-076:
 * everything mounts once; a desktop-only tree plus separate mobile panes would be breakpoint-branched
 * markup, the ADR-017 hydration violation). All state lives in TripBuilderProvider (useTripBuilder.tsx);
 * this file just composes the pure pieces. The map is NOT here — PlanShell renders MapTripCanvas in its
 * own grid cell from the same provider. Fully functional without the agent.
 */
export function TripBuilder() {
  const { err, trips, trip, addPark, overPackedDays } = useTripBuilder();

  if (err) return <Box p={4}><Text color="fg.muted">{err}</Text></Box>;

  return (
    <Stack p={4} gap={4} h="100%" overflowY="auto">
      <Heading size="md">Trips</Heading>
      <TripSwitcher />

      {trip ? (
        <>
          <Separator />
          {/* key by trip id: a real trip SWITCH resets TripHeader's local rename/origin editor state
              (the monolith did this in openTrip); a same-id background refresh keeps the same key so a
              ranger refresh never closes an open editor (ADR-076). */}
          <TripHeader key={trip.id} />
          <ParkSearchInput onSelect={addPark} />
          <StopList />
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
          <TripActions />
          <TripInsights />
        </>
      ) : trips.length === 0 ? (
        // No-trips hero (P3.5): first-run — name a trip above, or hand off to the ranger.
        <EmptyState
          icon={<LuMapPinned />}
          title="Plan your first trip"
          description="Name a trip above to start adding parks, or let the ranger draft one from what you love."
        >
          <Button colorPalette="pine" variant="outline" onClick={() => requestPlanPane('ranger')}>
            <Icon><LuSparkles /></Icon>
            Ask the ranger
          </Button>
        </EmptyState>
      ) : (
        <Text color="fg.muted" fontSize="sm">Select a trip above to keep building, or create a new one.</Text>
      )}
    </Stack>
  );
}
