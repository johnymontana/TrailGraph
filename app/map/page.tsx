import { Box, Heading, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { MapExplorer } from '../../components/MapExplorer';
import { RangerCommandBar } from '../../components/map/RangerCommandBar';
import { getServerUserId } from '../../lib/session';
import { consideredBounds } from '../../lib/memory-graph';
import { facets, trailThemes } from '../../lib/queries';
import { decodeMapView } from '../../lib/map-deeplink';
import { unstable_cache } from 'next/cache';

/** Full-screen map explorer (B1-B3). Offers a list-view equivalent for accessibility (WCAG, §14). */
export const dynamic = 'force-dynamic';

// Facet/theme values change only on a sync, so cache them instead of re-querying on every page load (#8b/#5).
const cachedFacets = unstable_cache(async () => facets(), ['map:facets'], { revalidate: 3600, tags: ['facets'] });
const cachedTrailThemes = unstable_cache(async () => trailThemes(), ['map:trail-themes'], { revalidate: 3600, tags: ['facets'] });

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A "share this view" deep-link (#10) seeds the camera + instrument settings; absent/invalid → ignored.
  const initialView = decodeMapView(await searchParams);
  // Memory-driven default view (R4 §4): center on the signed-in user's considered parks if any.
  const userId = await getServerUserId();
  const [initialBounds, facetData, trailData] = await Promise.all([
    userId ? consideredBounds(userId).catch(() => null) : Promise.resolve(null),
    // Facet options for the map's state/activity/topic filters (#8b).
    cachedFacets().catch(() => ({ activities: [], topics: [], states: [] as { code: string; name: string }[] })),
    // Topic/person options for the connections layer (#5).
    cachedTrailThemes().catch(() => ({ people: [] as { title: string; parks: number }[], topics: [] as { name: string; parks: number }[] })),
  ]);
  const facetOptions = { states: facetData.states, activities: facetData.activities, topics: facetData.topics };
  // Connections/thematic-trail options must be the CURATED trail themes (topics shared by ≥3 parks, from
  // trailThemes), not every graph topic — a 1–2-park topic makes no trail. People come from the same source.
  const connectionOptions = { topics: trailData.topics.map((t) => t.name), people: trailData.people.map((p) => p.title) };
  return (
    <Box position="fixed" top="57px" left={0} right={0} bottom={0} data-fullscreen>
      <Heading as="h1" srOnly>Map of National Parks</Heading>
      <MapExplorer initialBounds={initialBounds} facetOptions={facetOptions} connectionOptions={connectionOptions} signedIn={!!userId} initialView={initialView} />
      {/* Natural-language ranger command bar (#7): docked top-center; fires trailgraph:map-focus → MapExplorer rings + flies. */}
      <RangerCommandBar />
      <CLink
        asChild
        position="absolute"
        bottom={3}
        left={3}
        bg="bg.panel"
        borderWidth="1px"
        borderRadius="md"
        px={3}
        py={1.5}
        fontSize="sm"
        shadow="md"
      >
        <NextLink href="/explore">List view →</NextLink>
      </CLink>
    </Box>
  );
}
