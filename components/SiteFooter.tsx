import { Box, Container, Flex, HStack, Icon, SimpleGrid, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuMountainSnow } from 'react-icons/lu';

const FOOTER_LINKS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Explore',
    links: [
      { href: '/explore', label: 'Browse parks' },
      { href: '/search', label: 'Vibe search' },
      { href: '/map', label: 'Map' },
      { href: '/graph', label: 'Graph' },
    ],
  },
  {
    heading: 'Plan',
    links: [
      { href: '/plan', label: 'Plan with the ranger' },
      { href: '/journeys', label: 'Journeys' },
      { href: '/me', label: 'Your memory' },
    ],
  },
];

/** Global footer — brand line, navigation, and the single canonical NPS disclaimer (was repeated inline). */
export function SiteFooter() {
  return (
    <Box as="footer" borderTopWidth="1px" borderColor="border" bg="bg.panel" mt={16}>
      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 10, md: 12 }}>
        <Flex direction={{ base: 'column', md: 'row' }} gap={{ base: 8, md: 12 }} justify="space-between">
          <Stack gap={3} maxW="sm">
            <HStack gap={2}>
              <Icon color="brand.solid" boxSize={5}><LuMountainSnow /></Icon>
              <Text fontFamily="heading" fontWeight="bold" letterSpacing="0.06em" fontSize="lg">
                TRAILGRAPH
              </Text>
            </HStack>
            <Text fontSize="sm" color="fg.muted">
              470+ NPS sites as a connected graph, with an AI ranger that remembers what you love and plans
              around it.
            </Text>
          </Stack>

          <SimpleGrid columns={{ base: 2, sm: 2 }} gap={{ base: 8, md: 16 }}>
            {FOOTER_LINKS.map((col) => (
              <Stack key={col.heading} gap={2}>
                <Text fontSize="xs" fontWeight="semibold" color="fg.subtle" textTransform="uppercase" letterSpacing="0.06em">
                  {col.heading}
                </Text>
                {col.links.map((l) => (
                  <CLink key={l.href} asChild fontSize="sm" color="fg.muted" _hover={{ color: 'brand.fg' }}>
                    <NextLink href={l.href}>{l.label}</NextLink>
                  </CLink>
                ))}
              </Stack>
            ))}
          </SimpleGrid>
        </Flex>

        <Text fontSize="xs" color="fg.subtle" mt={10} pt={6} borderTopWidth="1px" borderColor="border.muted">
          Not an official NPS safety source — always defer to{' '}
          <CLink href="https://www.nps.gov" target="_blank" rel="noopener noreferrer" color="brand.fg">
            NPS.gov
          </CLink>{' '}
          and park rangers for current conditions, closures, and safety information.
        </Text>
      </Container>
    </Box>
  );
}
