'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MlMap, type Marker as MlMarker, type GeoJSONSource, type ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Button, HStack, IconButton, Icon, Stack, Text } from '@chakra-ui/react';
import { LuX } from 'react-icons/lu';
import { mapStyle, US_BOUNDS, registerMapProtocols, attachBasemapFallback } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';
import { designationKey, designationIcon, designationMatchStops, designationDefaultColor } from '../../lib/mapLegend';
import { markerImageId, attachMarkerImages } from '../../lib/mapMarkers';
import { renderTripOverlay, type TripMapStop, type TripMapOrigin } from '../../lib/trip-map-render';
import type { ParkPoint } from '../../lib/queries';
import type { TripMetrics } from '../../lib/trip-lab';

/**
 * Build-on-map canvas (#9): the planning surface where you assemble a trip by CLICKING parks. Every located
 * `:Park` is a clustered, designation-colored dot (parks already in the trip drop out of the clickable set);
 * clicking one pops "Add to trip", which POSTs `addStop` and bubbles the fresh trip + live metrics up to the
 * builder (which re-renders + fires the `trailgraph:*` events that keep the ranger chat in sync). The numbered
 * route overlay (shared with `TripMap` via `lib/trip-map-render`) redraws stop-to-stop as the plan assembles.
 *
 * Under the plan shell (ADR-076) this is the permanent map pane, so:
 *  • `tripId` is nullable — with no trip open the parks still render for browsing and the popup says
 *    "Open a trip to add parks" instead of the Add button;
 *  • maplibre construction is GATED on a non-zero container (the NvlGraph pattern): the pane can mount
 *    `display:none` on mobile, and the constructor `US_BOUNDS` fit + load-time trip fit compute from
 *    container size — `map.resize()` alone never recovers the camera from a 0×0 birth;
 *  • `cooperativeGestures` is a prop: true when embedded in a scrollable column (legacy default), false
 *    from the shell where the pane is full-bleed (matching MapExplorer).
 *
 * Like every map here it FULLY re-creates on colorMode change, so all state lives in refs and re-applies in
 * `map.on('load')`. Trip mutations are rate-capped server-side (ORS cost) — a 429 surfaces as a note.
 */
export interface CanvasMutation {
  trip: { id: string; name: string; stops: unknown[] } | null;
  metrics: TripMetrics | null;
}

export function MapTripCanvas({
  tripId,
  stops,
  origin,
  addedParkCodes,
  metrics,
  onMutated,
  cooperativeGestures = true,
}: {
  tripId: string | null;
  stops: TripMapStop[];
  origin?: TripMapOrigin | null;
  addedParkCodes: string[];
  metrics?: TripMetrics | null;
  onMutated: (data: CanvasMutation) => void;
  /** One-finger-scroll cooperation — keep true inside scrollable columns; the shell passes false (full-bleed pane). */
  cooperativeGestures?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const allParksRef = useRef<ParkPoint[] | null>(null);
  const stopsRef = useRef(stops);
  const originRef = useRef<TripMapOrigin | null>(origin ?? null);
  const addedRef = useRef<Set<string>>(new Set(addedParkCodes));
  const markersRef = useRef<MlMarker[]>([]);
  const drawRef = useRef<{ stop: () => void } | null>(null);
  const tripIdRef = useRef(tripId);
  const framedTripRef = useRef<string | null>(null); // last trip id the camera framed — reframe only on switch
  const pendingFrameRef = useRef(false); // a trip switched while the pane was hidden (0×0) — reframe on reveal
  const onMutatedRef = useRef(onMutated);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const { colorMode } = useColorMode();
  const c = brandColors(colorMode);
  const [note, setNote] = useState<string | null>(null);
  // The park tapped on the map (P3.7): drives a React bottom card instead of a maplibre popup, so the Add
  // button is a real ≥40px control and the card reads like the rest of the UI. Coords ride along for the pulse.
  const [selected, setSelected] = useState<{ parkCode: string; name: string; designation?: string; lng: number; lat: number } | null>(null);

  // A short ring pulse at the just-added park (P3.7) — Web Animations, no global keyframe needed.
  function pulseAt(lng: number, lat: number) {
    const map = mapRef.current;
    if (!map || typeof document === 'undefined') return;
    const el = document.createElement('div');
    Object.assign(el.style, { width: '20px', height: '20px', borderRadius: '50%', border: `2px solid ${c.pine}`, pointerEvents: 'none' });
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    const anim = el.animate?.([{ transform: 'scale(0.5)', opacity: 0.9 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 850, easing: 'ease-out' });
    if (anim) anim.onfinish = () => marker.remove();
    else window.setTimeout(() => marker.remove(), 850);
  }

  stopsRef.current = stops;
  originRef.current = origin ?? null;
  tripIdRef.current = tripId;
  onMutatedRef.current = onMutated;
  addedRef.current = new Set(addedParkCodes);

  // Build the parks FeatureCollection from the raw list MINUS parks already in the trip (so the route's
  // numbered markers and the addable dots never double up), baking designation color + icon (#2/#9).
  function applyParks(map: MlMap) {
    const all = allParksRef.current;
    if (!all) return;
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: all
        .filter((p) => p.lat != null && p.lng != null && !addedRef.current.has(p.parkCode))
        .map((p) => {
          const dk = designationKey(p.designation);
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng as number, p.lat as number] },
            properties: { parkCode: p.parkCode, name: p.name, designation: p.designation, desigKey: dk, icon: markerImageId(designationIcon(dk)) },
          };
        }),
    };
    (map.getSource('canvas-parks') as GeoJSONSource | undefined)?.setData(fc);
  }

  // POST addStop for a chosen park, then bubble the new trip + live metrics up to the builder (#9) and pulse
  // the spot (P3.7). Called by the React bottom card's Add button.
  async function addPark(park: { parkCode: string; name: string; lng: number; lat: number }) {
    if (busyRef.current || !tripIdRef.current) return;
    busyRef.current = true;
    setSelected(null);
    setNote(`Adding ${park.name}…`);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripIdRef.current)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'addStop', stop: { kind: 'park', refId: park.parkCode } }),
        signal: abortRef.current?.signal,
      });
      if (res.status === 429) {
        const retry = res.headers.get('Retry-After');
        setNote(`Too many edits — wait ${retry ?? 'a moment'}s`);
        return;
      }
      if (!res.ok) {
        setNote('Could not add that park');
        return;
      }
      const data = (await res.json()) as CanvasMutation;
      onMutatedRef.current(data);
      pulseAt(park.lng, park.lat);
      setNote(`Added ${park.name}`);
    } catch {
      /* aborted / network — leave the trip unchanged */
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    registerMapProtocols();
    const ac = new AbortController();
    abortRef.current = ac;
    let map: MlMap | null = null;
    let disposed = false;

    // Source/layer creation, guarded so it can re-run after ANY style swap: the basemap fallback calls
    // map.setStyle(demo) on a broken .pmtiles, which used to wipe canvas-parks permanently — the add flow
    // died until a colorMode remount (the load-only install). MapExplorer's installLayers convention.
    const installLayers = (m: MlMap) => {
      if (m.getSource('canvas-parks')) return;
      const parkColorExpr = ['match', ['get', 'desigKey'], ...designationMatchStops(colorMode), designationDefaultColor(colorMode)] as unknown as ExpressionSpecification;
      m.addSource('canvas-parks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 8, clusterRadius: 50 });
      m.addLayer({ id: 'canvas-clusters', type: 'circle', source: 'canvas-parks', filter: ['has', 'point_count'],
        paint: { 'circle-color': c.pine, 'circle-opacity': 0.8, 'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 30, 26] } });
      m.addLayer({ id: 'canvas-cluster-count', type: 'symbol', source: 'canvas-parks', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12, 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#fff' } });
      m.addLayer({ id: 'canvas-park', type: 'circle', source: 'canvas-parks', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': parkColorExpr, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } });
      m.addLayer({ id: 'canvas-park-icon', type: 'symbol', source: 'canvas-parks', filter: ['!', ['has', 'point_count']],
        layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.55, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      // Invisible fat hit target (P3.7): the visible dot is 6px, murder to tap on touch — a transparent
      // ~14px circle around each dot makes the whole ~24px area tappable. Handlers bind to this layer.
      m.addLayer({ id: 'canvas-park-hit', type: 'circle', source: 'canvas-parks', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 14 } });
    };

    const init = () => {
      if (disposed || map) return;
      let m: MlMap;
      try {
        // cooperativeGestures per the prop: inside a scrollable column a bare map is a scroll trap —
        // one-finger drags pan the map (mobile) and the wheel zooms it (desktop) instead of scrolling
        // the pane. The shell's full-bleed pane turns it off (nothing behind the map to scroll).
        m = new maplibregl.Map({ container, style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'), bounds: US_BOUNDS, fitBoundsOptions: { padding: 24 }, cooperativeGestures });
        attachBasemapFallback(m);
      } catch (err) {
        console.warn('[MapTripCanvas] map unavailable (WebGL?):', (err as Error).message);
        return;
      }
      map = m;
      mapRef.current = m;
      let initialized = false;

      m.on('load', async () => {
        attachMarkerImages(m); // styleimagemissing hook — survives setStyle image wipes (#2d)
        installLayers(m);

        // Tap an addable park (on the fat hit layer, P3.7) → open the React bottom card via state. Layer-
        // scoped handlers attach ONCE — they survive setStyle by id; re-adding double-fires. setSelected is
        // a stable useState setter, safe to call from this load-time closure.
        m.on('mouseenter', 'canvas-park-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'canvas-park-hit', () => { m.getCanvas().style.cursor = ''; });
        m.on('click', 'canvas-park-hit', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as { parkCode: string; name: string; designation?: string };
          const [lng, lat] = (f.geometry as Point).coordinates;
          setSelected({ parkCode: props.parkCode, name: props.name ?? props.parkCode, designation: props.designation, lng, lat });
        });
        // Tap the map background (not on a park dot) → dismiss the card. The layer handler above runs first;
        // this general handler queries the hit layer so it doesn't clobber a fresh selection.
        m.on('click', (e) => {
          if (m.queryRenderedFeatures(e.point, { layers: ['canvas-park-hit'] }).length === 0) setSelected(null);
        });
        // Cluster → zoom to expand.
        m.on('click', 'canvas-clusters', (e) => {
          const f = m.queryRenderedFeatures(e.point, { layers: ['canvas-clusters'] })[0];
          if (!f) return;
          (m.getSource('canvas-parks') as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id).then((zoom) =>
            m.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom }),
          );
        });

        // Mark initialized BEFORE the awaited fetch: attachBasemapFallback can setStyle(demo) on a broken
        // pmtiles host DURING this await, firing a style.load we must NOT gate off — else the wiped
        // canvas-parks source is never reinstalled and the add flow dies until a colorMode remount.
        initialized = true;

        // Load parks once, then paint the parks + the current route overlay.
        if (!allParksRef.current) {
          try {
            const res = await fetch('/api/graph?op=parks-all', { signal: ac.signal });
            const { parks } = (await res.json()) as { parks: ParkPoint[] };
            allParksRef.current = parks ?? [];
          } catch {
            // Don't poison the cache on an abort (a colorMode swap mid-fetch) — leaving it null lets the
            // recreated map refetch (matches MapExplorer.loadAllParks). Only a real error yields an empty set.
            if (!ac.signal.aborted) allParksRef.current = [];
          }
        }
        if (ac.signal.aborted) return; // the map may have been removed during the await — never touch it
        // A fallback setStyle may be mid-flight (style not yet loaded): its style.load handler (now
        // un-gated) will reinstall + repaint. Painting here would throw "Style is not done loading".
        if (!m.isStyleLoaded()) return;
        applyParks(m);
        renderTripOverlay(m, stopsRef.current, c, markersRef, drawRef, true, true, originRef.current); // frame existing stops on open
        framedTripRef.current = tripIdRef.current;
      });
      // After a style swap (the basemap fallback), re-install the wiped source/layers + re-paint.
      // 'style.load' also fires on the initial style — gate on `initialized` so first paint stays
      // the load handler's job (which awaits the parks fetch + frames the camera).
      m.on('style.load', () => {
        if (!initialized || ac.signal.aborted) return;
        installLayers(m);
        applyParks(m);
        renderTripOverlay(m, stopsRef.current, c, markersRef, drawRef, false, false, originRef.current);
      });
    };

    // Init gate + resize in ONE observer (ADR-076, the NvlGraph non-zero-mount pattern): under the plan
    // shell this pane can mount display:none (mobile default pane = Itinerary), and a map born at 0×0
    // gets a degenerate camera nothing re-frames. Defer construction until the container has real size —
    // the first tab reveal constructs against true dimensions, so the normal frame-on-open path just works.
    if (container.clientWidth > 0 && container.clientHeight > 0) init();
    const ro = new ResizeObserver(() => {
      if (!map) {
        if (container.clientWidth > 0 && container.clientHeight > 0) init();
      } else {
        // The pane can also narrow while visible (scrollbar appears) — maplibre only tracks window resize.
        map.resize();
        // Reveal after a trip switched while the pane was hidden (ADR-076): the stops effect drew the
        // markers but deferred the camera fit (fitBounds no-ops on a 0×0 canvas) — do it now.
        if (pendingFrameRef.current && container.clientWidth > 0 && container.clientHeight > 0 && map.isStyleLoaded()) {
          pendingFrameRef.current = false;
          renderTripOverlay(map, stopsRef.current, c, markersRef, drawRef, true, true, originRef.current);
          framedTripRef.current = tripIdRef.current;
        }
      }
    });
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      drawRef.current?.stop();
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
      ac.abort();
      mapRef.current = null;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, cooperativeGestures]);

  // Re-paint the addable parks (added set changed) + redraw the route whenever the stops change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      applyParks(map);
      // Reframe only when the active TRIP changed (switched trips, opened the first one, or deselected)
      // — not when a park was added to the current one (you just clicked it, it's on-screen; yanking the
      // camera mid-build is jarring). (#9, review MEDIUM-3)
      const switched = framedTripRef.current !== tripId;
      // If the pane is hidden (0×0 — a trip switched from the itinerary/ranger tab, ADR-076), draw the
      // markers/line but DON'T fit: fitBounds no-ops on a zero-size canvas and would falsely mark the
      // trip framed. Defer the fit to the reveal (the ResizeObserver), leaving framedTripRef untouched.
      const hidden = map.getContainer().clientWidth === 0 || map.getContainer().clientHeight === 0;
      renderTripOverlay(map, stopsRef.current, c, markersRef, drawRef, true, switched && !hidden, originRef.current);
      if (switched && hidden) pendingFrameRef.current = true;
      else framedTripRef.current = tripIdRef.current;
    };
    // A stops update can land while the style is momentarily not loaded (mid style/terrain reload). The old
    // bail-with-no-retry dropped that render until the next map interaction ("stops don't show till you move
    // the map") — retry on the next idle instead.
    if (map.isStyleLoaded()) render();
    else map.once('idle', render);
    return () => { map.off('idle', render); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, addedParkCodes, origin, tripId]);

  // The "Added X" / rate-limit note reads like a toast — let it auto-dismiss (and clear on unmount).
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 2500);
    return () => window.clearTimeout(t);
  }, [note]);

  const hrs = (min: number | null | undefined) => (min == null ? null : Math.round((min / 60) * 10) / 10);

  return (
    <Box position="relative" w="full" h="full" minH="320px">
      <div ref={ref} style={{ position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden' }} aria-label="Build your trip on the map" role="application" />
      {/* Live running-total badge (#9): drive/cost/dark-hours after each click. */}
      {metrics && metrics.stops > 0 ? (
        <HStack position="absolute" top={2} left={2} bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="md" px={2.5} py={1.5} gap={3} shadow="sm" fontSize="xs">
          <Text><Text as="span" fontWeight="600">{metrics.stops}</Text> stop{metrics.stops === 1 ? '' : 's'}</Text>
          {metrics.driveMiles > 0 ? <Text color="fg.muted">{Math.round(metrics.driveMiles)} mi · {hrs(metrics.driveMinutes)} h</Text> : null}
          {metrics.costTotal > 0 ? <Text color="fg.muted">${metrics.costTotal}</Text> : null}
          {metrics.darkHoursTotal != null ? <Text color="fg.muted">{Math.round(metrics.darkHoursTotal)} dark h</Text> : null}
        </HStack>
      ) : null}
      {/* Selected-park bottom card (P3.7): replaces the maplibre popup with a real UI card — name +
          designation + a finger-sized Add (or a browse hint with no trip open). Sits above the note/pill. */}
      {selected ? (
        <Box position="absolute" bottom={{ base: 20, md: 4 }} left="50%" transform="translateX(-50%)" w="calc(100% - 24px)" maxW="360px" zIndex={2}
          bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="l2" shadow="lg" p={3}>
          <HStack align="start" gap={2}>
            <Stack gap={0.5} flex="1" minW={0}>
              <Text fontWeight="semibold" lineClamp={1}>{selected.name}</Text>
              {selected.designation ? <Text fontSize="xs" color="fg.muted" lineClamp={1}>{selected.designation}</Text> : null}
            </Stack>
            <IconButton size="xs" variant="ghost" aria-label="Dismiss" minW="8" minH="8" onClick={() => setSelected(null)}>
              <LuX />
            </IconButton>
          </HStack>
          {tripId ? ( // the reactive prop (not the ref) so the button appears the moment a trip opens
            <Button mt={2} w="full" size="sm" minH="10" colorPalette="pine" style={{ touchAction: 'manipulation' }}
              onClick={() => addPark({ parkCode: selected.parkCode, name: selected.name, lng: selected.lng, lat: selected.lat })}>
              Add to trip
            </Button>
          ) : (
            <Text mt={2} fontSize="xs" color="fg.muted">Open a trip to add parks.</Text>
          )}
        </Box>
      ) : null}
      {note ? (
        <Box position="absolute" bottom={2} left="50%" transform="translateX(-50%)" bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="full" px={3} py={1} shadow="sm" fontSize="xs" aria-live="polite">
          <Text>{note}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
