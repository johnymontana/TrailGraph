import { Box, Heading, SimpleGrid, Stack, Text, Input, Button, NativeSelect, Flex, Badge, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { unstable_cache } from 'next/cache';
import { searchParks, facets } from '../../lib/queries';
import { forYou } from '../../lib/recommend';
import { getServerUserId } from '../../lib/session';
import { ParkCard } from '../../components/ParkCard';

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
    <Box maxW="6xl" mx="auto" px={{ base: 4, md: 8 }} py={6}>
      {/* "For you" (E2): personalized when we know the user, popular for cold-start. */}
      {recs && recs.parks.length > 0 ? (
        <Box mb={8}>
          <Flex align="center" gap={2} mb={3}>
            <Heading size="md">For you</Heading>
            <Badge colorPalette={recs.source === 'personalized' ? 'green' : 'gray'}>
              {recs.source === 'personalized' ? 'based on your preferences' : 'popular picks'}
            </Badge>
          </Flex>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap={4}>
            {recs.parks.map((p) => (
              <Box key={p.parkCode}>
                <ParkCard park={p} />
                {recs.source === 'personalized' && p.matched.length > 0 ? (
                  <CLink href="/me" display="block" fontSize="xs" color="fg.muted" mt={1} title="See this in Your memory">
                    Because you liked {p.matched.slice(0, 3).join(', ')}
                  </CLink>
                ) : null}
              </Box>
            ))}
          </SimpleGrid>
        </Box>
      ) : null}

      <Heading as="h1" size="lg" mb={4}>
        Explore the National Parks
      </Heading>

      <form method="get">
        <Flex gap={3} wrap="wrap" mb={6} align="end">
          <Box>
            <Text fontSize="xs" color="fg.muted">Search</Text>
            <Input name="q" defaultValue={sp.q ?? ''} placeholder="name or description" w="240px" />
          </Box>
          <FacetSelect name="activity" label="Activity" value={sp.activity} options={f.activities} />
          <FacetSelect name="topic" label="Topic" value={sp.topic} options={f.topics} />
          {f.amenities.length > 0 ? (
            <FacetSelect name="amenity" label="Amenity" value={sp.amenity} options={f.amenities} />
          ) : null}
          <FacetSelect name="designation" label="Designation" value={sp.designation} options={f.designations} />
          <FacetSelect
            name="stateCode"
            label="State"
            value={sp.stateCode}
            options={f.states.map((s) => s.code)}
          />
          <Box as="label" display="flex" alignItems="center" gap={2} pb={2}>
            <input type="checkbox" name="darkSky" value="1" defaultChecked={sp.darkSky === '1'} />
            <Text fontSize="sm">Dark-sky parks</Text>
          </Box>
          <Button type="submit" colorPalette="blue">
            Apply
          </Button>
        </Flex>
      </form>

      <Text color="fg.muted" mb={3}>
        {total === 0 ? '0 parks' : `Showing ${firstIdx}–${lastIdx} of ${total} park${total === 1 ? '' : 's'}`}
      </Text>

      {results.length === 0 ? (
        <Stack py={12} align="center" color="fg.muted">
          <Text>No parks matched — try clearing a filter or searching a different term.</Text>
          <CLink asChild color="blue.600"><NextLink href="/explore">Reset filters</NextLink></CLink>
        </Stack>
      ) : (
        <>
          <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={4}>
            {results.map((p) => (
              <ParkCard key={p.parkCode} park={p} />
            ))}
          </SimpleGrid>
          {(hasPrev || hasNext) ? (
            <Flex justify="center" align="center" gap={4} mt={8}>
              {hasPrev ? (
                <Button asChild variant="outline" size="sm"><NextLink href={pageHref(page - 1)}>← Prev</NextLink></Button>
              ) : (
                <Button variant="outline" size="sm" disabled>← Prev</Button>
              )}
              <Text fontSize="sm" color="fg.muted">Page {page}</Text>
              {hasNext ? (
                <Button asChild variant="outline" size="sm"><NextLink href={pageHref(page + 1)}>Next →</NextLink></Button>
              ) : (
                <Button variant="outline" size="sm" disabled>Next →</Button>
              )}
            </Flex>
          ) : null}
        </>
      )}
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
    <Box>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <NativeSelect.Root w="190px">
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
    </Box>
  );
}
