'use client';
import { Box, HStack, Text } from '@chakra-ui/react';
import { TripDashboardCard } from '../conditions/ConditionCards';
import { AlertList } from '../chat/Cards';
import { useTripBuilder } from './useTripBuilder';

/**
 * The result cards the action row produces (alerts / cost / conditions). Attaches the provider's reveal
 * refs so the check ops can scroll their card into view when the button produced it (never on the
 * auto-loaded open-trip alerts) — the one place the ops layer touches this pane's DOM (ADR-076).
 */
export function TripInsights() {
  const { trip, alerts, cost, costErr, dashboard, alertsRef, costRef, condRef } = useTripBuilder();
  if (!trip) return null;

  return (
    <>
      {/* Structured, shared alert card (P1.2) — same component the chat uses, instead of a bespoke list. */}
      {alerts ? <Box ref={alertsRef}><AlertList data={{ parks: alerts }} /></Box> : null}
      {cost ? (
        <Box ref={costRef} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={3}>
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
          <Box ref={condRef}><TripDashboardCard data={dashboard as unknown as Record<string, unknown>} /></Box>
        )
      ) : null}
    </>
  );
}
