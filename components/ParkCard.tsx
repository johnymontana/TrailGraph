import { Box, Text, Badge, Stack, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import NextImage from 'next/image';
import type { ParkSummary } from '../lib/queries';
import { Placeholder } from './Placeholder';

/** Graph-grounded park card (R6): always links to the canonical park detail page. */
export function ParkCard({ park, miles }: { park: ParkSummary & { miles?: number }; miles?: number }) {
  const dist = miles ?? park.miles;
  // Truncate long state lists (e.g. Appalachian Trail spans 14 states) so a single card can't outgrow
  // its grid track and overlap its neighbor (QA R3 §4.1). "CT, GA, MA +11".
  const stateList = (park.states ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const statesLabel =
    stateList.length > 3 ? `${stateList.slice(0, 3).join(', ')} +${stateList.length - 3}` : stateList.join(', ');
  return (
    <CLink asChild _hover={{ textDecoration: 'none' }}>
      <NextLink href={`/parks/${park.parkCode}`}>
      <Box minW={0} borderWidth="1px" borderRadius="lg" overflow="hidden" bg="bg.panel" _hover={{ shadow: 'md' }}>
        <Box h="140px" position="relative" overflow="hidden">
          {park.image ? (
            <NextImage
              src={park.image}
              alt={park.name}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            // Branded placeholder for parks with no dataset image (§3.5, ADR-039).
            <Placeholder name={park.parkCode} label={park.name} />
          )}
          {/* At-a-glance facets as badges (ADR-039): dark-sky + accessible, surfaced from the summary. */}
          {park.darkSky || park.accessible ? (
            <HStack position="absolute" top={1} right={1} gap={1}>
              {park.darkSky ? (
                <Badge bg="blackAlpha.700" color="white" title="Dark-sky park">⭐</Badge>
              ) : null}
              {park.accessible ? (
                <Badge bg="blackAlpha.700" color="white" title="Wheelchair-accessible camping">♿</Badge>
              ) : null}
            </HStack>
          ) : null}
        </Box>
        <Stack p={3} gap={1}>
          <Text fontWeight="semibold" lineClamp={1}>
            {park.name}
          </Text>
          <Box minW={0}>
            {park.designation ? (
              <Badge colorPalette="blue" mr={2}>
                {park.designation}
              </Badge>
            ) : null}
            <Text as="span" fontSize="sm" color="fg.muted" lineClamp={1}>
              {statesLabel}
              {dist != null ? ` · ${Math.round(dist)} mi` : ''}
            </Text>
          </Box>
        </Stack>
      </Box>
      </NextLink>
    </CLink>
  );
}
