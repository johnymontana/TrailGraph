'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MlMap, type Marker as MlMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Image from 'next/image';
import NextLink from 'next/link';
import { Box, Flex, Stack, Heading, Text, Badge, HStack, Icon, Link as CLink } from '@chakra-ui/react';
import { LuGraduationCap, LuMap } from 'react-icons/lu';
import { mapStyle, registerMapProtocols, attachBasemapFallback, enableTerrain, disableTerrain, terrainConfigured, US_CENTER } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';
import { renderTripOverlay, prefersReducedMotion, type TripMapStop } from '../../lib/trip-map-render';
import { bearingBetween } from '../../lib/fly-through';

/**
 * Scrollytelling 3D tour (#11B): a sticky terrain map flies park-to-park as the reader scrolls the narrative
 * panels beside it. The active panel is detected with an IntersectionObserver (centered in the viewport) and
 * the map `flyTo`s that park, pitched, banking toward it. Reuses the trail-overlay renderer for the route +
 * numbered markers. Like every map here it re-creates on colorMode change, so the active index lives in a ref
 * and re-applies on load. 3D needs a configured DEM (`enableTerrain`); without one it's a flat, gently-tilted
 * fly — still a tour. Honors prefers-reduced-motion (jumps instead of flies).
 */
export interface TourStop {
  parkCode: string;
  name: string;
  designation: string;
  lat: number;
  lng: number;
  image: string | null;
  via: string;
  lesson: { title: string; href: string } | null;
}

export function StoryTour({ stops, theme, kind }: { stops: TourStop[]; theme: string; kind: 'person' | 'topic' }) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<MlMarker[]>([]);
  const drawRef = useRef<{ stop: () => void } | null>(null);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const { colorMode } = useColorMode();
  const c = brandColors(colorMode);

  const tripStops: TripMapStop[] = stops.map((s, i) => ({ lat: s.lat, lng: s.lng, label: s.name, order: i }));

  function flyTo(i: number) {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const s = stops[i];
    if (!s) return;
    const prev = stops[i - 1];
    const bearing = prev ? bearingBetween([prev.lng, prev.lat], [s.lng, s.lat]) : 0;
    if (prefersReducedMotion()) {
      map.jumpTo({ center: [s.lng, s.lat], zoom: 8.5, pitch: 0, bearing: 0 });
    } else {
      map.flyTo({ center: [s.lng, s.lat], zoom: 9.2, pitch: terrainConfigured() ? 62 : 32, bearing, duration: 2600, essential: true });
    }
  }

  useEffect(() => {
    if (!mapDiv.current) return;
    registerMapProtocols();
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: mapDiv.current, style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'), center: US_CENTER, zoom: 3 });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[StoryTour] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    mapRef.current = map;
    map.on('load', () => {
      enableTerrain(map); // 3D when a DEM is configured; a no-op otherwise (flat, pitched fly)
      renderTripOverlay(map, tripStops, c, markersRef, drawRef, false, false); // draw the trail; don't auto-fit
      flyTo(activeRef.current); // frame the active panel's park
    });
    return () => {
      drawRef.current?.stop();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      disableTerrain(map);
      mapRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // Scroll → active panel (centered in the viewport) → fly the map there.
  useEffect(() => {
    const root = panelsRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll('[data-tour-panel]')) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.tourIndex);
          if (!Number.isNaN(i) && i !== activeRef.current) {
            activeRef.current = i;
            setActive(i);
            flyTo(i);
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.length]);

  return (
    <Flex direction={{ base: 'column', md: 'row' }} align="start">
      {/* Sticky terrain map */}
      <Box position="sticky" top="57px" flexShrink={0} w={{ base: '100%', md: '56%' }} h={{ base: '46vh', md: 'calc(100vh - 57px)' }} bg="bg.panel">
        <div ref={mapDiv} style={{ position: 'absolute', inset: 0 }} aria-label={`3D tour map of the ${theme} trail`} role="application" />
        <Box position="absolute" top={3} left={3} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" maxW="72%">
          <Text fontSize="2xs" textTransform="uppercase" letterSpacing="0.05em" color="fg.subtle">{kind === 'person' ? 'In the footsteps of' : 'A trail through'}</Text>
          <Text fontSize="sm" fontWeight="semibold" lineClamp={1}>{theme}</Text>
          <Text fontSize="xs" color="fg.muted">Stop {active + 1} of {stops.length} · {stops[active]?.name}</Text>
        </Box>
      </Box>

      {/* Narrative panels */}
      <Box ref={panelsRef} w={{ base: '100%', md: '44%' }} px={{ base: 5, md: 10 }}>
        <Box display={{ base: 'none', md: 'block' }} minH="28vh" />
        {stops.map((s, i) => (
          <Box
            key={s.parkCode}
            data-tour-panel
            data-tour-index={i}
            minH={{ base: 'auto', md: '78vh' }}
            display="flex"
            flexDirection="column"
            justifyContent="center"
            py={{ base: 8, md: 0 }}
          >
            <Stack gap={3} opacity={active === i ? 1 : 0.5} transition="opacity 0.4s">
              <HStack>
                <Badge colorPalette="pine" variant="subtle">Stop {i + 1}</Badge>
                {s.designation ? <Text fontSize="xs" color="fg.muted">{s.designation}</Text> : null}
              </HStack>
              <Heading size="lg">{s.name}</Heading>
              {s.image ? (
                <Box position="relative" w="full" h="200px" borderRadius="l2" overflow="hidden">
                  <Image src={s.image} alt={s.name} fill style={{ objectFit: 'cover' }} sizes="(max-width: 768px) 100vw, 40vw" />
                </Box>
              ) : null}
              <Text color="fg.muted" fontSize="sm">{kind === 'person' ? `Tied to ${theme}.` : `On the ${theme} trail.`}</Text>
              <HStack gap={5} fontSize="sm">
                <CLink asChild color="brand.fg" fontWeight="medium">
                  <NextLink href={`/parks/${s.parkCode}`}><Icon mr={1}><LuMap /></Icon>Explore park</NextLink>
                </CLink>
                {s.lesson ? (
                  <CLink asChild color="brand.fg" fontWeight="medium">
                    <NextLink href={s.lesson.href}><Icon mr={1}><LuGraduationCap /></Icon>Learn more</NextLink>
                  </CLink>
                ) : null}
              </HStack>
            </Stack>
          </Box>
        ))}
        <Box py={{ base: 10, md: 16 }}>
          <Heading size="md" mb={2}>That&apos;s the {theme} trail.</Heading>
          <Text color="fg.muted" fontSize="sm" mb={4}>{stops.length} parks, one story — build it into a trip or see the full graph.</Text>
          <HStack gap={5}>
            <CLink asChild color="brand.fg" fontWeight="medium">
              <NextLink href={`/trails?${kind}=${encodeURIComponent(theme)}`}>See all parks →</NextLink>
            </CLink>
            <CLink asChild color="brand.fg" fontWeight="medium">
              <NextLink href="/plan">Plan a trip →</NextLink>
            </CLink>
          </HStack>
        </Box>
      </Box>
    </Flex>
  );
}
