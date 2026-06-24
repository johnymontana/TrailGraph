import { Badge, Box, Card, HStack, Icon, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import NextImage from 'next/image';
import { LuAccessibility, LuStar } from 'react-icons/lu';
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
    <CLink asChild _hover={{ textDecoration: 'none' }} display="block" w="full" h="full">
      <NextLink href={`/parks/${park.parkCode}`}>
        <Card.Root variant="interactive" overflow="hidden" minW={0} w="full" h="full">
          <Box h="200px" position="relative" overflow="hidden">
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

            {/* Bottom scrim so the overlaid park name stays legible over any photo. */}
            {park.image ? (
              <Box
                position="absolute"
                inset={0}
                style={{ background: 'linear-gradient(to top, rgba(11,46,30,0.85) 0%, rgba(11,46,30,0.15) 45%, transparent 70%)' }}
              />
            ) : null}

            {/* At-a-glance facets as icon chips (ADR-039): dark-sky + accessible + fee-free. */}
            {park.darkSky || park.accessible || park.feeFree ? (
              <HStack position="absolute" top={2} right={2} gap={1}>
                {park.feeFree ? (
                  <Badge bg="blackAlpha.700" color="white" gap={1} title="No entrance fee" aria-label="No entrance fee">
                    Free
                  </Badge>
                ) : null}
                {park.darkSky ? (
                  <Badge bg="blackAlpha.700" color="white" gap={1} title="Dark-sky park" aria-label="Dark-sky park">
                    <Icon boxSize={3}><LuStar /></Icon>
                  </Badge>
                ) : null}
                {park.accessible ? (
                  <Badge
                    bg="blackAlpha.700"
                    color="white"
                    gap={1}
                    title="Wheelchair-accessible camping"
                    aria-label="Wheelchair-accessible camping"
                  >
                    <Icon boxSize={3}><LuAccessibility /></Icon>
                  </Badge>
                ) : null}
              </HStack>
            ) : null}

            {/* Overlaid park name (image cards only) — magazine-style title. */}
            {park.image ? (
              <Text
                position="absolute"
                bottom={3}
                left={3}
                right={3}
                color="white"
                fontFamily="heading"
                fontWeight="bold"
                fontSize="lg"
                lineHeight="1.15"
                lineClamp={2}
                textShadow="0 1px 8px rgba(0,0,0,0.5)"
              >
                {park.name}
              </Text>
            ) : null}
          </Box>

          <Card.Body p={3} gap={1}>
            {/* Placeholder cards have no overlaid title (the placeholder shows the name), so add it here. */}
            {!park.image ? (
              <Text fontFamily="heading" fontWeight="semibold" lineClamp={1}>
                {park.name}
              </Text>
            ) : null}
            <HStack gap={2} minW={0}>
              {park.designation ? (
                <Badge colorPalette="pine" flexShrink={0}>
                  {park.designation}
                </Badge>
              ) : null}
              <Text fontSize="sm" color="fg.muted" lineClamp={1}>
                {statesLabel}
                {dist != null ? ` · ${Math.round(dist)} mi` : ''}
              </Text>
            </HStack>
          </Card.Body>
        </Card.Root>
      </NextLink>
    </CLink>
  );
}
