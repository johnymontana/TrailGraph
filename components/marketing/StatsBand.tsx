import { Box, Container, Icon, SimpleGrid, Stack, Text, VStack } from '@chakra-ui/react';
import { LuMoonStar, LuRoute, LuTrees, LuWaypoints } from 'react-icons/lu';
import type { LandingStats } from '../../lib/queries';

/**
 * Landing stats band — adapted from the Chakra UI Pro "stat-centered" block (ADR-054), re-tokenized to
 * the topographic theme (pine accents, fg.muted labels, a contour-panel surface). Server component (no
 * client deps); counts come straight from the graph (`landingStats`), reinforcing the graph-native story.
 */
const ITEMS: { key: keyof LandingStats; label: string; icon: typeof LuTrees; suffix?: string }[] = [
  { key: 'parks', label: 'National park sites', icon: LuTrees, suffix: '+' },
  { key: 'darkSky', label: 'Dark-sky parks', icon: LuMoonStar },
  { key: 'activities', label: 'Activities to match', icon: LuRoute },
  { key: 'topics', label: 'Themes in the graph', icon: LuWaypoints },
];

export function StatsBand({ stats }: { stats: LandingStats }) {
  return (
    <Box borderBottomWidth="1px" borderColor="border" bg="bg.subtle">
      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 10, md: 12 }}>
        <SimpleGrid columns={{ base: 2, lg: 4 }} gap={{ base: 6, md: 4 }}>
          {ITEMS.map((item) => (
            <VStack key={item.key} gap={1} textAlign="center">
              <Icon color="brand.fg" boxSize={5} mb={1}>
                <item.icon />
              </Icon>
              <Text textStyle={{ base: '3xl', md: '4xl' }} fontFamily="heading" fontWeight="semibold" lineHeight="1">
                {stats[item.key].toLocaleString()}
                {item.suffix ?? ''}
              </Text>
              <Text color="fg.muted" fontSize="sm" whiteSpace={{ md: 'nowrap' }}>
                {item.label}
              </Text>
            </VStack>
          ))}
        </SimpleGrid>
        <Stack mt={6} align="center">
          <Text fontSize="xs" color="fg.subtle" textAlign="center">
            One Neo4j graph holds the parks, the connections between them, and your evolving trip memory.
          </Text>
        </Stack>
      </Container>
    </Box>
  );
}
