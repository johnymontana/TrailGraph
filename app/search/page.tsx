import { Box, Card, Container, Heading, Icon, SimpleGrid, Stack, Text, Input, Button, Flex, Badge, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import NextImage from 'next/image';
import { LuSearch, LuSparkles } from 'react-icons/lu';
import { headers } from 'next/headers';
import { vibeSearch, semanticSearch, semanticArticles, semanticTrails, type SemanticHit, type ArticleHit, type TrailSummary } from '../../lib/queries';
import { searchCampgrounds, type CampgroundSummary } from '../../lib/campgrounds';
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
  let trails: TrailSummary[] = [];
  let campgrounds: CampgroundSummary[] = [];
  let places: SemanticHit[] = [];
  let people: SemanticHit[] = [];
  let articles: ArticleHit[] = [];
  let throttled = false;

  if (q) {
    // Anonymous compute guard (audit C5/C6): cap embeddings per IP. The query is embedded ONCE and the
    // vector reused across all three vector indexes (parks/places/people) instead of three embeds.
    const ip = clientIpFrom(await headers());
    const { ok } = await rateLimit(rlIp(ip, 'search'), 20, 60);
    if (!ok) {
      throttled = true;
    } else {
      // Campgrounds use a fulltext name match (no embedding index) — independent of the shared vector.
      campgrounds = await searchCampgrounds({ q, limit }).then((r) => r.items).catch(() => [] as CampgroundSummary[]);
      const vec = await embedQuery(q).catch(() => null);
      if (vec) {
        [parks, trails, places, people, articles] = await Promise.all([
          vibeSearch(q, { limit, vector: vec }).catch(() => [] as ParkHit[]),
          semanticTrails(q, limit, vec).catch(() => [] as TrailSummary[]),
          semanticSearch('place', q, limit, vec).catch(() => [] as SemanticHit[]),
          semanticSearch('person', q, limit, vec).catch(() => [] as SemanticHit[]),
          semanticArticles(q, limit, vec).catch(() => [] as ArticleHit[]),
        ]);
      }
    }
  }

  return (
    <Box>
      <PageHeader
        eyebrow="Vibe search"
        title="Search by meaning, not keywords"
        subtitle="Describe a vibe, a feature, a theme — we rank parks, places, people, and articles by what they're actually like."
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
          <Text color="fg.muted">Enter a description above to search across parks, places, people, and articles.</Text>
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

            <Section title="Trails" count={trails.length}>
              {trails.length === 0 ? (
                <Empty />
              ) : (
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={5}>
                  {trails.map((t) => (
                    <TrailHitCard key={t.id} hit={t} />
                  ))}
                </SimpleGrid>
              )}
            </Section>

            <Section title="Campgrounds" count={campgrounds.length}>
              {campgrounds.length === 0 ? (
                <Empty />
              ) : (
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={5}>
                  {campgrounds.map((c) => (
                    <CampgroundHitCard key={c.id} hit={c} />
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

            <Section title="Articles" count={articles.length}>
              {articles.length === 0 ? (
                <Empty />
              ) : (
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} gap={5}>
                  {articles.map((a) => (
                    <ArticleCard key={a.id} hit={a} />
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

const TRAIL_DIFF_PALETTE: Record<string, string> = { easy: 'teal', moderate: 'trail', strenuous: 'red' };

/** Trail result card (ADR-072 vibe-search) — links to the trail detail page. */
function TrailHitCard({ hit }: { hit: TrailSummary }) {
  const stats = [
    hit.lengthMiles != null ? `${hit.lengthMiles} mi` : null,
    hit.elevationGainFt != null ? `+${hit.elevationGainFt.toLocaleString()} ft` : null,
    hit.estTimeHrs != null ? `~${hit.estTimeHrs} hr` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <CLink asChild _hover={{ textDecoration: 'none' }} display="block" w="full" h="full">
      <NextLink href={`/trails/${encodeURIComponent(hit.id)}`}>
        <Card.Root variant="interactive" w="full" h="100%">
          <Card.Body p={3} gap={1}>
            <HStack wrap="wrap" gap={2}>
              <Badge colorPalette={TRAIL_DIFF_PALETTE[hit.difficulty ?? ''] ?? 'gray'}>{hit.difficulty ?? 'trail'}</Badge>
              <Text fontWeight="semibold" fontFamily="heading" lineClamp={1} flex="1">{hit.name}</Text>
              {hit.permitRequired ? <Badge colorPalette="orange">permit</Badge> : null}
            </HStack>
            {hit.parkName ? <Text fontSize="xs" color="fg.muted" lineClamp={1}>{hit.parkName}</Text> : null}
            {stats ? <Text fontSize="sm">{stats}</Text> : null}
          </Card.Body>
        </Card.Root>
      </NextLink>
    </CLink>
  );
}

const AGENCY_HIT_LABEL: Record<string, string> = { NPS: 'NPS', USFS: 'Forest Service', BLM: 'BLM', USACE: 'Army Corps', STATE: 'State', PRIVATE: 'Private' };

/** Campground result card — links to the campground detail page (id carries colons → encoded). */
function CampgroundHitCard({ hit }: { hit: CampgroundSummary }) {
  const stats = [
    hit.totalSites != null ? `${hit.totalSites} sites` : null,
    hit.free ? 'Free' : hit.feeUSD != null ? `$${hit.feeUSD}/night` : null,
    hit.hasHookups ? (hit.maxAmps ? `${hit.maxAmps}A hookups` : 'hookups') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <CLink asChild _hover={{ textDecoration: 'none' }} display="block" w="full" h="full">
      <NextLink href={`/campgrounds/${encodeURIComponent(hit.id)}`}>
        <Card.Root variant="interactive" w="full" h="100%">
          <Card.Body p={3} gap={1}>
            <HStack wrap="wrap" gap={2}>
              <Badge colorPalette="trail">{AGENCY_HIT_LABEL[hit.agency ?? ''] ?? 'camp'}</Badge>
              <Text fontWeight="semibold" fontFamily="heading" lineClamp={1} flex="1">{hit.name}</Text>
              {hit.dispersed ? <Badge colorPalette="sand">dispersed</Badge> : null}
            </HStack>
            {hit.parkName ?? hit.recAreaName ? <Text fontSize="xs" color="fg.muted" lineClamp={1}>{hit.parkName ?? hit.recAreaName}</Text> : null}
            {stats ? <Text fontSize="sm">{stats}</Text> : null}
          </Card.Body>
        </Card.Root>
      </NextLink>
    </CLink>
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

/** Article result card (F8) — links to the official NPS article; shows its related park. */
function ArticleCard({ hit }: { hit: ArticleHit }) {
  const park = hit.parks[0];
  return (
    <Card.Root variant="outline" overflow="hidden" w="full" h="100%">
      {hit.image ? (
        <Box h="120px" position="relative" overflow="hidden">
          <NextImage src={hit.image} alt={hit.title} fill sizes="(max-width: 768px) 100vw, 33vw" style={{ objectFit: 'cover' }} />
        </Box>
      ) : null}
      <Card.Body p={3} gap={1}>
        <HStack wrap="wrap" gap={2}>
          <Badge colorPalette="sand">article</Badge>
          {hit.url ? (
            <CLink href={hit.url} color="brand.fg" fontWeight="semibold" fontFamily="heading" lineClamp={1} flex="1">
              {hit.title} ↗
            </CLink>
          ) : (
            <Text fontWeight="semibold" fontFamily="heading" lineClamp={1} flex="1">{hit.title}</Text>
          )}
        </HStack>
        {park ? (
          <CLink asChild fontSize="xs" color="fg.muted">
            <NextLink href={`/parks/${park.parkCode}`}>at {park.parkName}</NextLink>
          </CLink>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}
