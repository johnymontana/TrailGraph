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
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { unstable_cache } from 'next/cache';
import { LuChevronLeft, LuChevronRight, LuSearch, LuTentTree } from 'react-icons/lu';
import { searchCampgrounds, campgroundFacets, campAvailabilityForList, type AvailabilityChipData } from '../../lib/campgrounds';
import { CampgroundCard } from '../../components/campgrounds/CampgroundCard';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState } from '../../components/ui/empty-state';
import { SectionHeading } from '../../components/ui/section-heading';

// Facets change only on a sync → cache for an hour (like /trails).
const cachedCampgroundFacets = unstable_cache(campgroundFacets, ['campground-facets'], { revalidate: 3600 });

/**
 * Campgrounds finder (Campgrounds feature) — RSC, faceted GET form (works without JS), results from Neo4j.
 * The multi-agency analogue of /trails: NPS · USFS · BLM · USACE · dispersed campgrounds with site-level
 * inventory. Availability is a Phase-2 overlay (always nullable); the card degrades to a recreation.gov link.
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;
const BOOKING = ['reservable', 'fcfs', 'free'];
const SITE_TYPES = ['tent', 'rv', 'group', 'cabin', 'walk-in', 'equestrian'];
const AMPS = ['20', '30', '50'];
const MAX_RV = ['20', '25', '30', '35', '40'];
const MAX_PRICE = ['0', '15', '25', '40'];
const MAX_ELEV = ['3000', '6000', '9000'];
const AGENCY_LABEL: Record<string, string> = {
  NPS: 'National Park Service',
  USFS: 'Forest Service',
  BLM: 'BLM',
  USACE: 'Army Corps',
  STATE: 'State',
  PRIVATE: 'Private',
};

export default async function CampgroundsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const pageSize = 24;
  const page = Math.max(1, Number(sp.page) || 1);
  const anyFilter = Object.keys(sp).some((k) => sp[k] && k !== 'page');

  const opts = {
    q: sp.q,
    nearParkCode: sp.park,
    agency: sp.agency,
    reservable: sp.booking === 'reservable' || undefined,
    fcfs: sp.booking === 'fcfs' || undefined,
    free: sp.booking === 'free' || undefined,
    siteType: sp.siteType,
    minAmps: sp.amps ? Number(sp.amps) : undefined,
    maxRvLength: sp.maxRv ? Number(sp.maxRv) : undefined,
    ada: sp.ada === '1' || undefined,
    pets: sp.pets === '1' || undefined,
    dumpStation: sp.dump === '1' || undefined,
    showers: sp.showers === '1' || undefined,
    drinkingWater: sp.water === '1' || undefined,
    cellReception: sp.cell === '1' || undefined,
    darkSky: sp.darksky === '1' || undefined,
    maxPriceUSD: sp.maxPrice ? Number(sp.maxPrice) : undefined,
    elevationMax: sp.maxElevation ? Number(sp.maxElevation) : undefined,
  };

  const [search, f] = await Promise.all([
    searchCampgrounds({ ...opts, limit: pageSize, offset: (page - 1) * pageSize }).catch(() => ({ items: [], total: 0 })),
    cachedCampgroundFacets().catch(() => ({ agencies: [], siteTypes: [], parks: [], recAreas: [], maxFeeUSD: null, maxRvLengthFt: null })),
  ]);

  // Discovery rails (only on the unfiltered landing view) — each degrades to [] on a cold data layer.
  const rails = anyFilter
    ? []
    : await Promise.all([
        searchCampgrounds({ dispersed: true, free: true, limit: 8 }).then((r) => ({ title: 'Free & dispersed', items: r.items })).catch(() => null),
        searchCampgrounds({ hookups: true, minAmps: 30, limit: 8 }).then((r) => ({ title: 'Full-hookup RV', items: r.items })).catch(() => null),
        searchCampgrounds({ darkSky: true, limit: 8 }).then((r) => ({ title: 'Dark-sky campgrounds', items: r.items })).catch(() => null),
      ]).then((rs) => rs.filter((r): r is { title: string; items: typeof search.items } => !!r && r.items.length > 0));

  const results = search.items;
  const total = search.total;

  // Availability chips: only when a date range is set. Gated/unreachable → every chip degrades to
  // "Check on recreation.gov ↗" (the adapter returns state:'unavailable'). Never blocks the page.
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const avail: Record<string, AvailabilityChipData> =
    ISO.test(sp.from ?? '') && ISO.test(sp.to ?? '')
      ? await campAvailabilityForList(
          results.map((c) => ({ id: c.id, ridbId: c.ridbId, totalSites: c.totalSites })),
          { from: sp.from!, to: sp.to! },
        ).catch(() => ({}))
      : {};

  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = (page - 1) * pageSize + results.length;
  const hasPrev = page > 1;
  const hasNext = lastIdx < total;
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'page') qs.set(k, v);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `/campgrounds?${s}` : '/campgrounds';
  };
  const agencyOptions = f.agencies.length ? f.agencies : ['NPS', 'USFS', 'BLM', 'USACE', 'STATE'];

  return (
    <Box>
      <PageHeader
        eyebrow="Campgrounds"
        title="Find a campsite"
        subtitle="National-park, Forest-Service, BLM, and dispersed campgrounds — by site type, hookups, RV length, accessibility, price, and more."
        contour
      />

      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
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
                  <Input name="q" defaultValue={sp.q ?? ''} placeholder="campground name" ps={9} />
                </Box>
              </Field.Root>
              <ParkSelect value={sp.park} options={f.parks} />
              <FacetSelect name="agency" label="Agency" value={sp.agency} options={agencyOptions} labelMap={AGENCY_LABEL} />
              <FacetSelect name="booking" label="Booking" value={sp.booking} options={BOOKING} capitalize />
              <FacetSelect name="siteType" label="Site type" value={sp.siteType} options={SITE_TYPES} capitalize />
              <FacetSelect name="amps" label="Min amps" value={sp.amps} options={AMPS} suffix="A" />
              <FacetSelect name="maxRv" label="Min RV length" value={sp.maxRv} options={MAX_RV} suffix=" ft" />
              <FacetSelect name="maxPrice" label="Max price" value={sp.maxPrice} options={MAX_PRICE} priceLabel />
              <FacetSelect name="maxElevation" label="Max elevation" value={sp.maxElevation} options={MAX_ELEV} suffix=" ft" />
              <Field.Root w={{ base: 'full', sm: '150px' }}>
                <Field.Label>Open from</Field.Label>
                <Input type="date" name="from" defaultValue={sp.from ?? ''} />
              </Field.Root>
              <Field.Root w={{ base: 'full', sm: '150px' }}>
                <Field.Label>to</Field.Label>
                <Input type="date" name="to" defaultValue={sp.to ?? ''} />
              </Field.Root>
              <Button type="submit" colorPalette="pine">Apply</Button>
            </Flex>
            <Flex gap={4} wrap="wrap" mt={3} pt={3} borderTopWidth="1px" borderColor="border">
              <FacetCheck name="ada" label="ADA / accessible" checked={sp.ada === '1'} />
              <FacetCheck name="pets" label="Pet-friendly" checked={sp.pets === '1'} />
              <FacetCheck name="dump" label="Dump station" checked={sp.dump === '1'} />
              <FacetCheck name="showers" label="Showers" checked={sp.showers === '1'} />
              <FacetCheck name="water" label="Potable water" checked={sp.water === '1'} />
              <FacetCheck name="cell" label="Cell reception" checked={sp.cell === '1'} />
              <FacetCheck name="darksky" label="Dark sky" checked={sp.darksky === '1'} />
            </Flex>
          </form>
        </Box>

        <Text color="fg.muted" mb={4} fontSize="sm">
          {total === 0 ? '0 campgrounds' : `Showing ${firstIdx}–${lastIdx} of ${total} campground${total === 1 ? '' : 's'}`}
        </Text>

        {results.length === 0 ? (
          <>
            <EmptyState
              icon={<LuTentTree />}
              title={anyFilter ? 'No campgrounds matched' : 'Campground data is on its way'}
              description={
                anyFilter
                  ? 'Try clearing a filter, widening the price range, or searching near a different park.'
                  : "We're ingesting site-level campground inventory from NPS, Recreation.gov (RIDB), and the Forest Service. Meanwhile, browse parks or trails."
              }
              py={16}
            >
              <Button asChild colorPalette="pine" variant="outline" mt={2}>
                <NextLink href={anyFilter ? '/campgrounds' : '/trails'}>{anyFilter ? 'Reset filters' : 'Browse trails'}</NextLink>
              </Button>
            </EmptyState>

            {rails.length > 0 ? (
              <Stack gap={10} mt={4}>
                {rails.map((rail) => (
                  <Box key={rail.title}>
                    <SectionHeading title={rail.title} />
                    <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5} mt={3}>
                      {rail.items.slice(0, 8).map((cg) => (
                        <CampgroundCard key={cg.id} cg={cg} />
                      ))}
                    </SimpleGrid>
                  </Box>
                ))}
              </Stack>
            ) : null}
          </>
        ) : (
          <>
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
              {results.map((cg) => (
                <CampgroundCard key={cg.id} cg={cg} availability={avail[cg.id]} />
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
      <Field.Label>Near park</Field.Label>
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
  priceLabel,
  labelMap,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
  capitalize?: boolean;
  suffix?: string;
  priceLabel?: boolean;
  labelMap?: Record<string, string>;
}) {
  const optionLabel = (o: string) => {
    if (priceLabel) return o === '0' ? 'Free' : `$${o}`;
    if (labelMap) return labelMap[o] ?? o;
    return `${o}${suffix ?? ''}`;
  };
  return (
    <Field.Root w={{ base: 'full', sm: '170px' }}>
      <Field.Label>{label}</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field name={name} defaultValue={value ?? ''} textTransform={capitalize ? 'capitalize' : undefined}>
          <option value="">Any</option>
          {options.filter(Boolean).map((o) => (
            <option key={o} value={o}>{optionLabel(o)}</option>
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
