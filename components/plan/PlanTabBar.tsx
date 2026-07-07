'use client';
import { Badge, Box, Button, HStack, Icon, Text } from '@chakra-ui/react';
import { LuMap, LuListChecks, LuSparkles } from 'react-icons/lu';
import { useTripBuilder } from './useTripBuilder';
import type { PlanPane } from './PlanShell';

/**
 * The base-only bottom tab bar (ADR-076): Map / Itinerary / Ranger, each a full-viewport pane. Built from
 * Button/Badge primitives — deliberately NOT Chakra `Tabs`, whose `hidden`-attr panel semantics fight the
 * md+ all-visible grid. ≥44px targets; the bar owns the home-indicator safe-area inset on notched phones
 * (PlanShell zeroes the chat input's own inset via --chat-safe-bottom so the two never stack).
 *
 * Badges: the Itinerary tab renders the open trip's stop count as a BARE numeric Badge (never the
 * "<n> stop(s)" string — that phrasing stays exclusive to the map metrics chip so existing e2e text
 * selectors don't strict-mode-collide) and flashes when a ranger edit lands while the pane is hidden;
 * the Ranger tab shows an unread dot while a reply streams into a hidden pane. Both clear on activation.
 */
export function PlanTabBar({
  pane,
  onSelect,
  flashItinerary,
  rangerUnread,
}: {
  pane: PlanPane;
  onSelect: (pane: PlanPane) => void;
  flashItinerary: boolean;
  rangerUnread: boolean;
}) {
  const { trip, stops } = useTripBuilder();
  const count = trip ? stops.length : null;

  const tabs: { key: PlanPane; label: string; icon: React.ReactNode; ariaLabel: string }[] = [
    { key: 'map', label: 'Map', icon: <LuMap />, ariaLabel: 'Map' },
    {
      key: 'itinerary',
      label: 'Itinerary',
      icon: <LuListChecks />,
      ariaLabel: count != null && count > 0 ? `Itinerary, ${count} stop${count === 1 ? '' : 's'}` : 'Itinerary',
    },
    { key: 'ranger', label: 'Ranger', icon: <LuSparkles />, ariaLabel: rangerUnread ? 'Ranger, new activity' : 'Ranger' },
  ];

  return (
    <HStack
      data-testid="plan-tab-bar"
      gridArea="tabs"
      display={{ base: 'flex', md: 'none' }}
      gap={0}
      borderTopWidth="1px"
      borderColor="border"
      bg="bg.panel"
      pb="env(safe-area-inset-bottom, 0px)"
    >
      {tabs.map((t) => {
        const active = pane === t.key;
        return (
          <Button
            key={t.key}
            flex="1"
            minH="12"
            variant="ghost"
            borderRadius={0}
            aria-label={t.ariaLabel}
            aria-current={active ? 'page' : undefined}
            color={active ? 'brand.fg' : 'fg.muted'}
            onClick={() => onSelect(t.key)}
          >
            <Box display="flex" flexDirection="column" alignItems="center" gap={0.5} position="relative">
              <Icon boxSize={5}>{t.icon}</Icon>
              <Text fontSize="2xs" fontWeight={active ? 'semibold' : 'normal'}>{t.label}</Text>
              {t.key === 'itinerary' && count != null && count > 0 ? (
                <Badge
                  data-testid="plan-tab-stops"
                  position="absolute"
                  top={-1}
                  right={-4}
                  size="xs"
                  variant="solid"
                  colorPalette={flashItinerary ? 'orange' : 'pine'}
                  css={flashItinerary ? { animation: 'tgPulse 1.2s infinite' } : undefined}
                >
                  {count}
                </Badge>
              ) : null}
              {t.key === 'ranger' && rangerUnread ? (
                <Box data-testid="plan-tab-unread" position="absolute" top={-1} right={-2} boxSize={2} borderRadius="full" bg="orange.solid" />
              ) : null}
            </Box>
          </Button>
        );
      })}
    </HStack>
  );
}
