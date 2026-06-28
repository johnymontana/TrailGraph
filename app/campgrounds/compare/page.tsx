import { Box, Badge, Container, Heading, HStack, Stack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { campgroundDetail, type CampgroundDetail } from '../../../lib/campgrounds';
import { campgroundScores, campgroundCompareData } from '../../../lib/camp-charts';
import { CampgroundCompare } from '../../../components/campgrounds/charts/CampgroundCompare';
import { PageHeader } from '../../../components/ui/page-header';
import { EmptyState } from '../../../components/ui/empty-state';
import { LuTentTree, LuArrowLeft } from 'react-icons/lu';

/**
 * Campground comparison scorecard (Campgrounds feature, Phase 3 viz). `/campgrounds/compare?ids=a,b,c` —
 * loads 2–4 campgrounds and renders a radar overlay (`CampgroundCompare`) + a side-by-side fact table over
 * the structured inventory. RSC; ids carry colons (`ridb:…`) so they're decoded per-id.
 */
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;

const AGENCY_LABEL: Record<string, string> = { NPS: 'NPS', USFS: 'Forest Service', BLM: 'BLM', USACE: 'Army Corps', STATE: 'State', PRIVATE: 'Private' };

function row(label: string, values: (string | number | null | undefined)[]) {
  return (
    <HStack gap={0} px={3} py={2} borderTopWidth="1px" borderColor="border" fontSize="sm">
      <Text flex="0 0 150px" color="fg.muted">{label}</Text>
      {values.map((v, i) => (
        <Text key={i} flex="1">{v == null || v === '' ? '—' : v}</Text>
      ))}
    </HStack>
  );
}

export default async function CampgroundComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ids = (sp.ids ?? '')
    .split(',')
    .map((s) => decodeURIComponent(s.trim()))
    .filter(Boolean)
    .slice(0, 4);

  const cgs = (await Promise.all(ids.map((id) => campgroundDetail(id).catch(() => null)))).filter(
    (c): c is CampgroundDetail => !!c,
  );

  if (cgs.length < 2) {
    return (
      <Box>
        <PageHeader eyebrow="Campgrounds" title="Compare campgrounds" contour />
        <Container maxW="5xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
          <EmptyState
            icon={<LuTentTree />}
            title="Pick 2–4 campgrounds to compare"
            description="Open a campground and choose “Compare,” or pass ?ids=a,b,c. We line them up across amenities, price, hookups, accessibility, size, connectivity, dark sky, and booking ease."
            py={16}
          >
            <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href="/campgrounds">Browse campgrounds →</NextLink></CLink>
          </EmptyState>
        </Container>
      </Box>
    );
  }

  const scored = cgs.map((c, i) => ({
    key: `c${i}`,
    name: c.name,
    cg: c,
    scores: campgroundScores({
      totalSites: c.totalSites,
      feeUSD: c.feeUSD,
      free: c.free,
      hasHookups: c.hasHookups,
      maxAmps: c.maxAmps,
      ada: c.ada,
      cellReception: c.cellReception,
      darkSky: c.darkSky,
      amenityCount: c.amenities.length,
      booksOutDays: c.booksOutDays,
    }),
  }));
  const radarData = campgroundCompareData(scored.map((s) => ({ key: s.key, scores: s.scores })));

  return (
    <Box>
      <PageHeader eyebrow="Campgrounds" title="Compare campgrounds" subtitle={cgs.map((c) => c.name).join(' vs ')} contour />
      <Container maxW="5xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        <CLink asChild fontSize="sm" color="fg.muted" _hover={{ color: 'brand.fg' }} mb={4} display="inline-block">
          <NextLink href="/campgrounds"><LuArrowLeft style={{ display: 'inline', verticalAlign: 'middle' }} /> All campgrounds</NextLink>
        </CLink>

        <CampgroundCompare data={radarData} campgrounds={scored.map((s) => ({ key: s.key, name: s.name }))} />

        {/* Side-by-side fact table */}
        <Box borderWidth="1px" borderColor="border" borderRadius="md" overflow="hidden" mt={6}>
          <HStack gap={0} px={3} py={2} bg="bg.panel" fontSize="sm" fontWeight="semibold">
            <Text flex="0 0 150px" color="fg.muted">Campground</Text>
            {cgs.map((c) => (
              <CLink key={c.id} asChild flex="1" color="brand.fg">
                <NextLink href={`/campgrounds/${encodeURIComponent(c.id)}`}>{c.name}</NextLink>
              </CLink>
            ))}
          </HStack>
          {row('Agency', cgs.map((c) => AGENCY_LABEL[c.agency ?? ''] ?? c.agency))}
          {row('Sites', cgs.map((c) => c.totalSites))}
          {row('Price', cgs.map((c) => (c.free ? 'Free' : c.feeUSD != null ? `$${c.feeUSD}/night` : null)))}
          {row('Hookups', cgs.map((c) => (c.hasHookups ? (c.maxAmps ? `${c.maxAmps}A` : 'yes') : 'no')))}
          {row('ADA sites', cgs.map((c) => (c.ada ? 'yes' : 'no')))}
          {row('Dump station', cgs.map((c) => (c.dumpStation ? 'yes' : 'no')))}
          {row('Cell reception', cgs.map((c) => (c.cellReception ? 'yes' : 'no')))}
          {row('Dark sky', cgs.map((c) => (c.darkSky ? 'yes' : 'no')))}
          {row('Books out', cgs.map((c) => (c.booksOutDays != null ? `~${c.booksOutDays} days` : 'unknown')))}
          {row('Nearest park', cgs.map((c) => c.parkName ?? c.nearParks[0]?.name ?? c.recAreaName))}
        </Box>

        <Stack mt={4}>
          <HStack gap={2} flexWrap="wrap">
            {cgs.map((c) => (
              <Badge key={c.id} variant="subtle">{c.name}: {c.dataConfidence ?? 'medium'} confidence</Badge>
            ))}
          </HStack>
          <Text fontSize="xs" color="fg.subtle">Scores are derived from operator-reported inventory — verify on recreation.gov before you book.</Text>
        </Stack>
      </Container>
    </Box>
  );
}
