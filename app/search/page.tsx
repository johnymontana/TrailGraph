import { Box, Card, Container, Heading, Icon, SimpleGrid, Stack, Text, Input, Button, Flex, Badge, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import NextImage from 'next/image';
import { LuSearch, LuSparkles } from 'react-icons/lu';
import { headers } from 'next/headers';
import { vibeSearch, semanticSearch, type SemanticHit } from '../../lib/queries';
import { embedQuery } from '../../lib/embed-cache';
import { rateLimit, rlIp, clientIpFrom } from '../../lib/rate-limit';
import { ParkCard } from '../../components/ParkCard';
import { Placeholder } from '../../components/Placeholder';
import { PageHeader } from '../../components/ui/page-header';
import { SectionHeading } from '../../components/ui/section-heading';
import { cleanTags } from '../../lib/people';

/**
 * Unified semantic search (NPS-expansion). One query box → three vector-ranked sections: parks (via
 * vibeSearch — first UI surface for it), places, and people. Server-rendered with a plain GET form so
 * it works without client JS, like /explore + /trails. Places/people link to their related park page
 * (no detail route exists). Results need populated embeddings + the AI Gateway (see embed-nodes.ts).
 */
export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'quiet alpine overlook with dark skies',
  'desert slot canyons and arches',
  'kid-friendly waterfalls and easy loops',
  'wildlife and birding near the coast',
];

type SP = Record<string, string | undefined>;

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() || '';
  const limit = 8;

  type ParkHit = Awaited<ReturnType<typeof vibeSearch>>[number];
  let parks: ParkHit[] = [];
  let places: SemanticHit[] = [];
  let people: SemanticHit[] = [];
  let throttled = false;

  if (q) {
    // Anonymous compute guard (audit C5/C6): cap embeddings per IP. The query is embedded ONCE and the
    // vector reused across all three vector indexes (parks/places/people) instead of three embeds.
    const ip = clientIpFrom(await headers());
    const { ok } = await rateLimit(rlIp(ip, 'search'), 20, 60);
    if (!ok) {
      throttled = true;
    } else {
      const vec = await embedQuery(q).catch(() => null);
      if (vec) {
        [parks, places, people] = await Promise.all([
          vibeSearch(q, { limit, vector: vec }).catch(() => [] as ParkHit[]),
          semanticSearch('place', q, limit, vec).catch(() => [] as SemanticHit[]),
          semanticSearch('person', q, limit, vec).catch(() => [] as SemanticHit[]),
        ]);
      }
    }
  }

  return (
    <Box>
      <PageHeader
        eyebrow="Vibe search"
        title="Search by meaning, not keywords"
        subtitle="Describe a vibe, a feature, a theme — we rank parks, places, and people by what they're actually like."
        contour
      >
        <Box mt={4} maxW="2xl">
          <form method="get">
            <Flex gap={3} direction={{ base: 'column', sm: 'row' }}>
              <Box position="relative" flex="1">
                <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="fg.subtle" pointerEvents="none" zIndex={1}>
                  <Icon boxSize={4}><LuSearch /></Icon>
                </Box>
                <Input name="q" defaultValue={q} placeholder="e.g. quiet alpine overlook with dark skies" ps={9} size="lg" bg="bg.panel" />
              </Box>
              <Button type="submit" colorPalette="pine" size="lg">
                <Icon><LuSparkles /></Icon> Search
              </Button>
            </Flex>
          </form>
          {!q ? (
            <HStack gap={2} mt={3} wrap="wrap">
              <Text fontSize="xs" color="fg.muted">Try:</Text>
              {EXAMPLES.map((ex) => (
                <CLink key={ex} asChild _hover={{ textDecoration: 'none' }}>
                  <NextLink href={`/search?q=${encodeURIComponent(ex)}`}>
                    <Badge colorPalette="sand" variant="subtle" cursor="pointer" _hover={{ bg: 'sand.muted' }}>
                      {ex}
                    </Badge>
                  </NextLink>
                </CLink>
              ))}
            </HStack>
          ) : null}
        </Box>
      </PageHeader>

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {!q ? (
          <Text color="fg.muted">Enter a description above to search across parks, places, and people.</Text>
        ) : throttled ? (
          <Text color="fg.muted">You&rsquo;re searching a lot right now — please wait a moment and try again.</Text>
        ) : (
          <Stack gap={12}>
            <Section title="Parks" count={parks.length}>
              {parks.length === 0 ? (
                <Empty />
              ) : (
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
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
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={5}>
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
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={5}>
                  {people.map((per) => (
                    <NodeCard key={per.id} hit={per} type="person" />
                  ))}
                </SimpleGrid>
              )}
            </Section>
          </Stack>
        )}
      </Container>
    </Box>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Box>
      <SectionHeading title={title} badge={String(count)} badgeTone="neutral" />
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
    <Card.Root variant={park ? 'interactive' : 'outline'} overflow="hidden" w="full" h="100%">
      {type === 'place' ? (
        <Box h="140px" position="relative" overflow="hidden">
          {hit.image ? (
            <NextImage src={hit.image} alt={hit.title} fill sizes="(max-width: 768px) 100vw, 33vw" style={{ objectFit: 'cover' }} />
          ) : (
            // Icon-only: the place title renders right below the thumbnail, so don't duplicate it.
            <Placeholder name={hit.id} iconOnly />
          )}
        </Box>
      ) : null}
      <Card.Body p={3} gap={1}>
        <HStack wrap="wrap" gap={2}>
          <Badge colorPalette={type === 'place' ? 'trail' : 'pine'}>{type}</Badge>
          <Text fontWeight="semibold" fontFamily="heading" lineClamp={1} flex="1">
            {hit.title}
          </Text>
          {type === 'place' && hit.isStamp ? <Badge colorPalette="trail" variant="solid">stamp</Badge> : null}
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
      </Card.Body>
    </Card.Root>
  );
  // Navigable target is the related park page; non-linked results render as a static card.
  return park ? (
    <CLink asChild _hover={{ textDecoration: 'none' }} display="block" w="full" h="full">
      <NextLink href={`/parks/${park.parkCode}`}>{card}</NextLink>
    </CLink>
  ) : (
    card
  );
}
