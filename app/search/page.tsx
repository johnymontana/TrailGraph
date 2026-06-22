import { Box, Heading, SimpleGrid, Stack, Text, Input, Button, Flex, Badge, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import NextImage from 'next/image';
import { vibeSearch, semanticSearch, type SemanticHit } from '../../lib/queries';
import { ParkCard } from '../../components/ParkCard';
import { Placeholder } from '../../components/Placeholder';
import { cleanTags } from '../../lib/people';

/**
 * Unified semantic search (NPS-expansion). One query box → three vector-ranked sections: parks (via
 * vibeSearch — first UI surface for it), places, and people. Server-rendered with a plain GET form so
 * it works without client JS, like /explore + /trails. Places/people link to their related park page
 * (no detail route exists). Results need populated embeddings + the AI Gateway (see embed-nodes.ts).
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || '';
  const limit = 8;

  const [parks, places, people] = q
    ? await Promise.all([
        vibeSearch(q, { limit }).catch(() => []),
        semanticSearch('place', q, limit).catch(() => [] as SemanticHit[]),
        semanticSearch('person', q, limit).catch(() => [] as SemanticHit[]),
      ])
    : [[], [], []];

  return (
    <Box maxW="6xl" mx="auto" px={{ base: 4, md: 8 }} py={6}>
      <Heading as="h1" size="lg" mb={2}>
        Search
      </Heading>
      <Text color="fg.muted" mb={6}>
        Describe what you&apos;re after — a vibe, a feature, a theme. We rank parks, places, and people by
        meaning, not just keywords.
      </Text>

      <form method="get">
        <Flex gap={3} mb={8} maxW="2xl">
          <Input name="q" defaultValue={q} placeholder="e.g. quiet alpine overlook with dark skies" flex="1" />
          <Button type="submit" colorPalette="blue">
            Search
          </Button>
        </Flex>
      </form>

      {!q ? (
        <Text color="fg.muted">Enter a description above to search across parks, places, and people.</Text>
      ) : (
        <Stack gap={10}>
          <Section title="Parks" count={parks.length}>
            {parks.length === 0 ? (
              <Empty />
            ) : (
              <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
                {parks.map((p) => (
                  <ParkCard key={p.parkCode} park={p} />
                ))}
              </SimpleGrid>
            )}
          </Section>

          <Section title="Places" count={places.length}>
            {places.length === 0 ? (
              <Empty />
            ) : (
              <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={4}>
                {places.map((pl) => (
                  <NodeCard key={pl.id} hit={pl} type="place" />
                ))}
              </SimpleGrid>
            )}
          </Section>

          <Section title="People" count={people.length}>
            {people.length === 0 ? (
              <Empty />
            ) : (
              <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={4}>
                {people.map((per) => (
                  <NodeCard key={per.id} hit={per} type="person" />
                ))}
              </SimpleGrid>
            )}
          </Section>
        </Stack>
      )}
    </Box>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Box>
      <Flex align="center" gap={2} mb={3}>
        <Heading size="md">{title}</Heading>
        <Badge colorPalette="gray">{count}</Badge>
      </Flex>
      {children}
    </Box>
  );
}

function Empty() {
  return (
    <Text color="fg.muted" fontSize="sm">
      No matches.
    </Text>
  );
}

/** Place/person result card — links to its top related park (no place/person detail route). */
function NodeCard({ hit, type }: { hit: SemanticHit; type: 'place' | 'person' }) {
  const park = hit.parks[0];
  const card = (
    <Box minW={0} borderWidth="1px" borderRadius="lg" overflow="hidden" bg="bg.panel" _hover={park ? { shadow: 'md' } : undefined} h="100%">
      {type === 'place' ? (
        <Box h="120px" position="relative" overflow="hidden">
          {hit.image ? (
            <NextImage src={hit.image} alt={hit.title} fill sizes="(max-width: 768px) 100vw, 33vw" style={{ objectFit: 'cover' }} />
          ) : (
            <Placeholder name={hit.id} label={hit.title} />
          )}
        </Box>
      ) : null}
      <Stack p={3} gap={1}>
        <HStack wrap="wrap" gap={2}>
          <Text fontWeight="semibold" lineClamp={1} flex="1">
            {hit.title}
          </Text>
          {type === 'place' && hit.isStamp ? <Badge colorPalette="orange">stamp</Badge> : null}
        </HStack>
        {type === 'person' ? (() => {
          const tags = cleanTags(hit.title, hit.tags);
          return tags.length ? (
            <Text fontSize="sm" color="fg.muted" lineClamp={1}>
              {tags.slice(0, 4).join(', ')}
            </Text>
          ) : null;
        })() : null}
        <Text fontSize="xs" color="fg.muted" lineClamp={1}>
          {park ? `at ${park.parkName}` : 'no linked park'}
        </Text>
      </Stack>
    </Box>
  );
  // Navigable target is the related park page; non-linked results render as a static card.
  return park ? (
    <CLink asChild _hover={{ textDecoration: 'none' }}>
      <NextLink href={`/parks/${park.parkCode}`}>{card}</NextLink>
    </CLink>
  ) : (
    card
  );
}
