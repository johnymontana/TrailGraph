import {
  Box,
  Button,
  Checkbox,
  Container,
  Field,
  Flex,
  HStack,
  Icon,
  Input,
  NativeSelect,
  SimpleGrid,
  Text,
  Badge,
  Wrap,
  WrapItem,
  Link as CLink,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { unstable_cache } from 'next/cache';
import { LuChevronLeft, LuChevronRight, LuSearch, LuFootprints } from 'react-icons/lu';
import { searchTrails, trailFacets } from '../../lib/queries';
import { trailProfiles } from '../../lib/trail-profiles';
import { TrailCard } from '../../components/trails/TrailCard';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState } from '../../components/ui/empty-state';

// Facets change only on a sync → cache for an hour (like /explore).
const cachedTrailFacets = unstable_cache(trailFacets, ['trail-facets'], { revalidate: 3600 });

/**
 * Trails finder (ADR-066/070) — RSC, faceted GET form (works without JS), results from Neo4j. The
 * center of gravity is hiking trails; a thin "activities" strip points at the broader park-activity data
 * in Explore until the activity-first lenses land (Phase 4). Thematic cross-park stories live at /journeys.
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;
const DIFFICULTIES = ['easy', 'moderate', 'strenuous'];
const USES = ['hike', 'bike', 'horse', 'ski', 'water'];
const MAX_MILES = ['3', '6', '10', '15'];
const MAX_GAIN = ['500', '1500', '3000'];

export default async function TrailsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const pageSize = 24;
  const page = Math.max(1, Number(sp.page) || 1);
  const [search, f] = await Promise.all([
    searchTrails({
      q: sp.q,
      parkCode: sp.park,
      difficulty: sp.difficulty,
      routeType: sp.routeType,
      surface: sp.surface,
      allowedUse: sp.use,
      maxMiles: sp.maxMiles ? Number(sp.maxMiles) : undefined,
      maxGainFt: sp.maxGainFt ? Number(sp.maxGainFt) : undefined,
      dogsAllowed: sp.dogs === '1',
      wheelchairAccessible: sp.accessible === '1',
      permitRequired: sp.permit === '1' ? true : undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    cachedTrailFacets().catch(() => ({ parks: [], surfaces: [], routeTypes: [] })),
  ]);

  const results = search.items;
  const total = search.total;
  // Elevation sparklines: load the result parks' profiles from Blob (deduped; empty until elevation-synced).
  const profiles = await trailProfiles(results.map((t) => t.parkCode)).catch(
    () => ({}) as Record<string, { distMi: number; elevFt: number }[]>,
  );
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = (page - 1) * pageSize + results.length;
  const hasPrev = page > 1;
  const hasNext = lastIdx < total;
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') qs.set(k, v);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `/trails?${s}` : '/trails';
  };
  const anyTrails = total > 0 || Object.keys(sp).some((k) => sp[k] && k !== 'page');

  return (
    <Box>
      <PageHeader
        eyebrow="Trails"
        title="Find your hike"
        subtitle="Real, hikeable trails by length, elevation, difficulty, route type, dogs, accessibility, and permits."
        contour
      />

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {/* Activity strip — hiking-first; the rest of the park-activity data lives in Explore for now.
            Wrap (not an HStack with standalone "·" separators) so it wraps cleanly on mobile with no
            orphaned middots when the long links break to new lines. */}
        <Wrap mb={6} gap={3} align="center">
          <WrapItem>
            <Badge colorPalette="pine" variant="solid" gap={1}><Icon boxSize={3}><LuFootprints /></Icon> Hiking</Badge>
          </WrapItem>
          <WrapItem>
            <CLink asChild fontSize="sm" color="fg.muted" _hover={{ color: 'brand.fg' }}>
              <NextLink href="/explore">Biking, paddling, stargazing &amp; more in Explore →</NextLink>
            </CLink>
          </WrapItem>
          <WrapItem>
            <CLink asChild fontSize="sm" color="fg.muted" _hover={{ color: 'brand.fg' }}>
              <NextLink href="/journeys">Thematic Journeys →</NextLink>
            </CLink>
          </WrapItem>
        </Wrap>

        {/* Filter bar — plain GET form, works without JS. */}
        <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={{ base: 4, md: 5 }} mb={6}>
          <form method="get">
            <Flex gap={4} wrap="wrap" align="end">
              <Field.Root w={{ base: 'full', sm: '220px' }}>
                <Field.Label>Search</Field.Label>
                <Box position="relative" w="full">
                  <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="fg.subtle" pointerEvents="none" zIndex={1}>
                    <Icon boxSize={4}><LuSearch /></Icon>
                  </Box>
                  <Input name="q" defaultValue={sp.q ?? ''} placeholder="trail name" ps={9} />
                </Box>
              </Field.Root>
              <ParkSelect value={sp.park} options={f.parks} />
              <FacetSelect name="difficulty" label="Difficulty" value={sp.difficulty} options={DIFFICULTIES} capitalize />
              <FacetSelect name="maxMiles" label="Max length" value={sp.maxMiles} options={MAX_MILES} suffix=" mi" />
              <FacetSelect name="maxGainFt" label="Max gain" value={sp.maxGainFt} options={MAX_GAIN} suffix=" ft" />
              <FacetSelect name="routeType" label="Route type" value={sp.routeType} options={f.routeTypes} capitalize />
              <FacetSelect name="use" label="Allowed use" value={sp.use} options={USES} capitalize />
              {f.surfaces.length > 0 ? <FacetSelect name="surface" label="Surface" value={sp.surface} options={f.surfaces} /> : null}
              <Button type="submit" colorPalette="pine">Apply</Button>
            </Flex>
            <Flex gap={4} wrap="wrap" mt={3} pt={3} borderTopWidth="1px" borderColor="border">
              <FacetCheck name="dogs" label="Dog-friendly" checked={sp.dogs === '1'} />
              <FacetCheck name="accessible" label="Wheelchair accessible" checked={sp.accessible === '1'} />
              <FacetCheck name="permit" label="Permit-required only" checked={sp.permit === '1'} />
            </Flex>
          </form>
        </Box>

        <Text color="fg.muted" mb={4} fontSize="sm">
          {total === 0 ? '0 trails' : `Showing ${firstIdx}–${lastIdx} of ${total} trail${total === 1 ? '' : 's'}`}
        </Text>

        {results.length === 0 ? (
          <EmptyState
            icon={<LuFootprints />}
            title={anyTrails ? 'No trails matched' : 'Trail data is on its way'}
            description={
              anyTrails
                ? 'Try clearing a filter or widening the length / elevation range.'
                : "We're ingesting real trail geometry, elevation, and difficulty from NPS Public Trails GIS. Meanwhile, browse parks or a thematic journey."
            }
            py={16}
          >
            <Button asChild colorPalette="pine" variant="outline" mt={2}>
              <NextLink href={anyTrails ? '/trails' : '/explore'}>{anyTrails ? 'Reset filters' : 'Browse parks'}</NextLink>
            </Button>
          </EmptyState>
        ) : (
          <>
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
              {results.map((t) => (
                <TrailCard key={t.id} trail={t} profile={profiles[t.id]} />
              ))}
            </SimpleGrid>
            {hasPrev || hasNext ? (
              <Flex justify="center" align="center" gap={4} mt={10}>
                {hasPrev ? (
                  <Button asChild variant="outline" size="sm">
                    <NextLink href={pageHref(page - 1)}><Icon><LuChevronLeft /></Icon> Prev</NextLink>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled><Icon><LuChevronLeft /></Icon> Prev</Button>
                )}
                <Text fontSize="sm" color="fg.muted">Page {page}</Text>
                {hasNext ? (
                  <Button asChild variant="outline" size="sm">
                    <NextLink href={pageHref(page + 1)}>Next <Icon><LuChevronRight /></Icon></NextLink>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>Next <Icon><LuChevronRight /></Icon></Button>
                )}
              </Flex>
            ) : null}
          </>
        )}
      </Container>
    </Box>
  );
}

function ParkSelect({ value, options }: { value?: string; options: { parkCode: string; name: string }[] }) {
  if (options.length === 0) return null;
  return (
    <Field.Root w={{ base: 'full', sm: '200px' }}>
      <Field.Label>Park</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field name="park" defaultValue={value ?? ''}>
          <option value="">Any park</option>
          {options.map((o) => (
            <option key={o.parkCode} value={o.parkCode}>{o.name}</option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}

function FacetSelect({
  name,
  label,
  value,
  options,
  capitalize,
  suffix,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
  capitalize?: boolean;
  suffix?: string;
}) {
  return (
    <Field.Root w={{ base: 'full', sm: '170px' }}>
      <Field.Label>{label}</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field name={name} defaultValue={value ?? ''} textTransform={capitalize ? 'capitalize' : undefined}>
          <option value="">Any</option>
          {options.filter(Boolean).map((o) => (
            <option key={o} value={o}>{`${o}${suffix ?? ''}`}</option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}

function FacetCheck({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <Checkbox.Root name={name} value="1" defaultChecked={checked} colorPalette="pine">
      <Checkbox.HiddenInput />
      <Checkbox.Control />
      <Checkbox.Label fontSize="sm">{label}</Checkbox.Label>
    </Checkbox.Root>
  );
}
