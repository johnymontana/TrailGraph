'use client';
import { Button, HStack, Icon, IconButton, Menu, Portal, Stack, Text } from '@chakra-ui/react';
import { LuChevronDown, LuCopy } from 'react-icons/lu';
import { toast } from '../../lib/toast';
import { useTripBuilder, touchTarget } from './useTripBuilder';

/**
 * The action row (Phase 0 shape, unchanged selectors): the six everyday checks stay visible with
 * `loading` states — these calls take seconds and used to give zero feedback — while Fork + the four
 * export artifacts collapse into "More" (was 11 peer buttons wrapping to ~4 rows on a phone). Renders
 * only when the trip has stops; the share row appears under it once a link exists.
 */
export function TripActions() {
  const { trip, stops, busyOps, shareUrl, checkAlerts, checkCost, checkConditions, suggestDayPlan, optimizeRoute, share, fork } = useTripBuilder();
  if (!trip || stops.length === 0) return null;

  return (
    <Stack gap={2}>
      <HStack wrap="wrap" gap={2}>
        <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('alerts')} onClick={checkAlerts}>
          Check alerts
        </Button>
        <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('cost')} onClick={checkCost}>
          Trip cost
        </Button>
        <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('conditions')} onClick={checkConditions}>
          Trip conditions
        </Button>
        <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('days')} onClick={suggestDayPlan}>
          Suggest day plan
        </Button>
        <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('optimize')} onClick={optimizeRoute}>
          Optimize route
        </Button>
        <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('share')} onClick={share}>
          Share
        </Button>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="sm" minH={{ base: '10', md: '8' }} variant="outline" loading={busyOps.has('fork')}>
              More
              <Icon boxSize={3.5}><LuChevronDown /></Icon>
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="fork" onClick={fork}>Fork</Menu.Item>
                <Menu.Item value="brief" asChild>
                  <a href={`/api/trips/${trip.id}/brief`} target="_blank" rel="noopener noreferrer">Field brief</a>
                </Menu.Item>
                <Menu.Item value="offline" asChild>
                  <a href={`/api/trips/${trip.id}/offline`}>Offline pack</a>
                </Menu.Item>
                <Menu.Item value="ics" asChild>
                  <a href={`/api/trips/${trip.id}/ics`}>Export .ics</a>
                </Menu.Item>
                <Menu.Item value="gpx" asChild>
                  <a href={`/api/trips/${trip.id}/gpx`}>Export .gpx</a>
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </HStack>
      {shareUrl ? (
        <HStack gap={1.5}>
          <Text fontSize="xs" color="fg.muted" minW={0} flex="1" truncate>
            Read-only link: <Text as="span" color="brand.fg">{shareUrl}</Text>
          </Text>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Copy share link"
            {...touchTarget}
            onClick={() => {
              navigator.clipboard?.writeText(shareUrl).then(
                () => toast.success('Share link copied'),
                () => toast.error("Couldn't copy — select the link text instead."),
              );
            }}
          >
            <LuCopy />
          </IconButton>
        </HStack>
      ) : null}
    </Stack>
  );
}
