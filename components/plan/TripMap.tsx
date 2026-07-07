'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MlMap, type Marker as MlMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Button, Icon } from '@chakra-ui/react';
import { LuPlay, LuSquare } from 'react-icons/lu';
import { mapStyle, US_CENTER, registerMapProtocols, attachBasemapFallback, enableTerrain, disableTerrain, terrainConfigured } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';
import { renderTripOverlay, prefersReducedMotion, type TripMapStop, type TripMapOrigin } from '../../lib/trip-map-render';
import { runFlyThrough, type FlyLeg } from '../../lib/fly-through';

/** Itinerary overlay (B4): numbered stop markers + a route line for the selected trip. */
export type { TripMapStop };

export function TripMap({ stops, origin }: { stops: TripMapStop[]; origin?: TripMapOrigin | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const stopsRef = useRef(stops);
  const originRef = useRef<TripMapOrigin | null>(origin ?? null);
  const markersRef = useRef<MlMarker[]>([]);
  const drawRef = useRef<{ stop: () => void } | null>(null);
  const flyAbortRef = useRef<AbortController | null>(null);
  const { colorMode } = useColorMode();
  const c = brandColors(colorMode);
  const [playing, setPlaying] = useState(false);
  stopsRef.current = stops;
  originRef.current = origin ?? null;

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    registerMapProtocols();
    let map: MlMap;
    try {
      // cooperativeGestures — this map embeds in scrollable pages (trip builder, shared trip, park pages),
      // where a bare map hijacks one-finger scrolling on touch and wheel-scrolling on desktop.
      map = new maplibregl.Map({ container, style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'), center: US_CENTER, zoom: 3, cooperativeGestures: true });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[TripMap] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    mapRef.current = map;
    map.on('load', () => renderTripOverlay(map, stopsRef.current, c, markersRef, drawRef, true, true, originRef.current));
    // Keep the GL canvas in sync with container size changes (maplibre only tracks window resize).
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      flyAbortRef.current?.abort();
      drawRef.current?.stop();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current = null; // so an in-flight fly-through's finally can tell the map was torn down
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // Re-render markers/line when stops change — and re-draw the route so the plan visibly assembles.
  // If the style is momentarily not loaded (terrain/style reload), retry on idle instead of dropping the
  // render (which left new stops invisible until the next map interaction).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => renderTripOverlay(map, stopsRef.current, c, markersRef, drawRef, true, true, originRef.current);
    if (map.isStyleLoaded()) render();
    else map.once('idle', render);
    return () => { map.off('idle', render); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, origin]);

  const located: FlyLeg[] = stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ lng: s.lng as number, lat: s.lat as number, label: s.label }));

  // Cinematic fly-through (#11A): enable 3D terrain (if a DEM is configured — else a flat pitched tour),
  // ease stop-to-stop, then restore the flat framed view. Abortable via the Stop control + map.stop().
  async function playFlyThrough() {
    const map = mapRef.current;
    if (!map || located.length < 2 || playing) return;
    const ac = new AbortController();
    flyAbortRef.current = ac;
    setPlaying(true);
    const hadTerrain = enableTerrain(map);
    try {
      await runFlyThrough(map, located, { signal: ac.signal, reduced: prefersReducedMotion() });
    } finally {
      // Only restore if this is still the same live map (a colorMode remount / unmount nulls mapRef + removes it).
      if (mapRef.current === map) {
        if (hadTerrain) disableTerrain(map);
        map.easeTo({ pitch: 0, bearing: 0, duration: 600 }); // back to flat
        renderTripOverlay(map, stopsRef.current, c, markersRef, drawRef, false, true, originRef.current);
      }
      if (flyAbortRef.current === ac) flyAbortRef.current = null;
      setPlaying(false);
    }
  }
  function stopFlyThrough() {
    flyAbortRef.current?.abort();
    mapRef.current?.stop(); // interrupt the in-flight easeTo immediately
  }

  return (
    <Box position="relative" w="full" h="260px" borderRadius={8} overflow="hidden">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} aria-label="Trip itinerary map" role="application" />
      {located.length >= 2 ? (
        <Button
          size="xs"
          position="absolute"
          top={2}
          right={2}
          colorPalette={playing ? 'red' : 'pine'}
          variant="solid"
          shadow="sm"
          onClick={playing ? stopFlyThrough : playFlyThrough}
          title={terrainConfigured() ? '3D fly-through of your trip' : 'Fly-through of your trip'}
        >
          <Icon mr={1}>{playing ? <LuSquare /> : <LuPlay />}</Icon>
          {playing ? 'Stop' : 'Fly-through'}
        </Button>
      ) : null}
    </Box>
  );
}
