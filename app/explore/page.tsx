import {
  Box,
  Button,
  Checkbox,
  Container,
  Field,
  Flex,
  Icon,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  Link as CLink,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { unstable_cache } from 'next/cache';
import { LuChevronLeft, LuChevronRight, LuSearch, LuTelescope } from 'react-icons/lu';
import { searchParks, facets } from '../../lib/queries';
import { forYou } from '../../lib/recommend';
import { getServerUserId } from '../../lib/session';
import { getTravelConstraints } from '../../lib/bridges';
import { ParkCard } from '../../components/ParkCard';
import { RankPanel } from '../../components/explore/RankPanel';
import { WhyThisPark } from '../../components/parks/WhyThisPark';
import { PageHeader } from '../../components/ui/page-header';
import { SectionHeading } from '../../components/ui/section-heading';
import { EmptyState } from '../../components/ui/empty-state';

// Facets are global + rarely change → cache for an hour (R4 §2.9). The per-user `forYou` and the
// param-specific park search stay dynamic for correctness.
const cachedFacets = unstable_cache(facets, ['explore-facets'], { revalidate: 3600 });

/**
 * Explore (A1, A3) — RSC. Faceted + full-text search. The filter form is a plain GET form so it
 * works without client JS; results are server-rendered from Neo4j (AD-4, <500ms TTFB target).
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

export default async function ExplorePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const userId = await getServerUserId();
  const pageSize = 24;
  const page = Math.max(1, Number(sp.page) || 1);
  const [search, f, recs] = await Promise.all([
    searchParks({
      q: sp.q,
      stateCode: sp.stateCode,
      activity: sp.activity,
      topic: sp.topic,
      amenity: sp.amenity,
      designation: sp.designation,
      darkSky: sp.darkSky === '1',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    cachedFacets(),
    userId ? forYou(userId, { limit: 4 }) : Promise.resolve(null),
  ]);
  // Saved travel constraints pre-fill the live "Refine live" sliders (ADR-046).
  const rankDefaults = userId
    ? await getTravelConstraints(userId)
        .then((c) => ({ rvMaxLengthFt: c.rvMaxLengthFt, wheelchairAccessible: c.wheelchair, requiredAmenities: c.requiredAmenities }))
        .catch(() => ({ rvMaxLengthFt: null, wheelchairAccessible: false, requiredAmenities: [] }))
    : { rvMaxLengthFt: null, wheelchairAccessible: false, requiredAmenities: [] };
  const results = search.items;
  const total = search.total;
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = (page - 1) * pageSize + results.length;
  const hasPrev = page > 1;
  const hasNext = lastIdx < total;
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') qs.set(k, v);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `/explore?${s}` : '/explore';
  };

  return (
    <Box>
      <PageHeader
        eyebrow="Explore"
        title="Find your park"
        subtitle="Search 470+ National Park Service sites by name, activity, topic, and more."
        contour
      />

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {/* "For you" (E2): personalized when we know the user, popular for cold-start. */}
        {recs && recs.parks.length > 0 ? (
          <Box mb={10}>
            <SectionHeading
              title="For you"
              badge={recs.source === 'personalized' ? 'based on your preferences' : 'popular picks'}
              badgeTone={recs.source === 'personalized' ? 'brand' : 'neutral'}
            />
            <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={5}>
              {recs.parks.map((p) => (
                <Box key={p.parkCode}>
                  <ParkCard park={p} />
                  {recs.source === 'personalized' && p.matched.length > 0 ? (
                    <>
                      <CLink href="/me" display="block" fontSize="xs" color="fg.muted" mt={1.5} title="See this in Your memory">
                        Because you liked {p.matched.slice(0, 3).join(', ')}
                      </CLink>
                      <WhyThisPark parkCode={p.parkCode} parkName={p.name} />
                    </>
                  ) : null}
                </Box>
              ))}
            </SimpleGrid>
          </Box>
        ) : null}

        {/* Filter bar — plain GET form, works without JS. */}
        <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={{ base: 4, md: 5 }} mb={6}>
          <form method="get">
            <Flex gap={4} wrap="wrap" align="end">
              <Field.Root w={{ base: 'full', sm: '240px' }}>
                <Field.Label>Search</Field.Label>
                <Box position="relative" w="full">
                  <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="fg.subtle" pointerEvents="none" zIndex={1}>
                    <Icon boxSize={4}><LuSearch /></Icon>
                  </Box>
                  <Input name="q" defaultValue={sp.q ?? ''} placeholder="name or description" ps={9} />
                </Box>
              </Field.Root>
              <FacetSelect name="activity" label="Activity" value={sp.activity} options={f.activities} />
              <FacetSelect name="topic" label="Topic" value={sp.topic} options={f.topics} />
              {f.amenities.length > 0 ? (
                <FacetSelect name="amenity" label="Amenity" value={sp.amenity} options={f.amenities} />
              ) : null}
              <FacetSelect name="designation" label="Designation" value={sp.designation} options={f.designations} />
              <FacetSelect name="stateCode" label="State" value={sp.stateCode} options={f.states.map((s) => s.code)} />
              <Checkbox.Root name="darkSky" value="1" defaultChecked={sp.darkSky === '1'} colorPalette="pine" pb={2}>
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label fontSize="sm">Dark-sky parks</Checkbox.Label>
              </Checkbox.Root>
              <Button type="submit" colorPalette="pine">
                Apply
              </Button>
            </Flex>
          </form>
        </Box>

        {/* Live constraint re-ranking (ADR-046) — progressive enhancement below the no-JS form. It refines
            WITHIN the active facets so it can't surface parks the faceted search excluded. */}
        <RankPanel
          defaults={rankDefaults}
          facets={{
            q: sp.q,
            stateCode: sp.stateCode,
            activity: sp.activity,
            topic: sp.topic,
            amenity: sp.amenity,
            designation: sp.designation,
            darkSky: sp.darkSky === '1',
          }}
        />

        <Text color="fg.muted" mb={4} fontSize="sm">
          {total === 0 ? '0 parks' : `Showing ${firstIdx}–${lastIdx} of ${total} park${total === 1 ? '' : 's'}`}
        </Text>

        {results.length === 0 ? (
          <EmptyState
            icon={<LuTelescope />}
            title="No parks matched"
            description="Try clearing a filter or searching a different term."
            py={16}
          >
            <Button asChild colorPalette="pine" variant="outline" mt={2}>
              <NextLink href="/explore">Reset filters</NextLink>
            </Button>
          </EmptyState>
        ) : (
          <>
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
              {results.map((p) => (
                <ParkCard key={p.parkCode} park={p} />
              ))}
            </SimpleGrid>
            {hasPrev || hasNext ? (
              <Flex justify="center" align="center" gap={4} mt={10}>
                {hasPrev ? (
                  <Button asChild variant="outline" size="sm">
                    <NextLink href={pageHref(page - 1)}>
                      <Icon><LuChevronLeft /></Icon> Prev
                    </NextLink>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <Icon><LuChevronLeft /></Icon> Prev
                  </Button>
                )}
                <Text fontSize="sm" color="fg.muted">Page {page}</Text>
                {hasNext ? (
                  <Button asChild variant="outline" size="sm">
                    <NextLink href={pageHref(page + 1)}>
                      Next <Icon><LuChevronRight /></Icon>
                    </NextLink>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Next <Icon><LuChevronRight /></Icon>
                  </Button>
                )}
              </Flex>
            ) : null}
          </>
        )}
      </Container>
    </Box>
  );
}

function FacetSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
}) {
  return (
    <Field.Root w={{ base: 'full', sm: '190px' }}>
      <Field.Label>{label}</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field name={name} defaultValue={value ?? ''}>
          <option value="">Any</option>
          {options.filter(Boolean).sort().map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}
