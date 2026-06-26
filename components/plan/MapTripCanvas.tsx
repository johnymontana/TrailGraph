'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MlMap, type Marker as MlMarker, type GeoJSONSource, type ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, HStack, Text } from '@chakra-ui/react';
import { mapStyle, US_BOUNDS, registerMapProtocols, attachBasemapFallback } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';
import { designationKey, designationIcon, designationMatchStops, designationDefaultColor } from '../../lib/mapLegend';
import { markerImageId, attachMarkerImages } from '../../lib/mapMarkers';
import { renderTripOverlay, type TripMapStop } from '../../lib/trip-map-render';
import type { ParkPoint } from '../../lib/queries';
import type { TripMetrics } from '../../lib/trip-lab';

/**
 * Build-on-map canvas (#9): the planning surface where you assemble a trip by CLICKING parks. Every located
 * `:Park` is a clustered, designation-colored dot (parks already in the trip drop out of the clickable set);
 * clicking one pops "Add to trip", which POSTs `addStop` and bubbles the fresh trip + live metrics up to the
 * builder (which re-renders + fires the `trailgraph:*` events that keep the ranger chat in sync). The numbered
 * route overlay (shared with `TripMap` via `lib/trip-map-render`) redraws stop-to-stop as the plan assembles.
 *
 * Like every map here it FULLY re-creates on colorMode change, so all state lives in refs and re-applies in
 * `map.on('load')`. Trip mutations are capped 30/60s server-side (ORS cost) — a 429 surfaces as a toast.
 */
export interface CanvasMutation {
  trip: { id: string; name: string; stops: unknown[] } | null;
  metrics: TripMetrics | null;
}

export function MapTripCanvas({
  tripId,
  stops,
  addedParkCodes,
  metrics,
  onMutated,
}: {
  tripId: string;
  stops: TripMapStop[];
  addedParkCodes: string[];
  metrics?: TripMetrics | null;
  onMutated: (data: CanvasMutation) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const allParksRef = useRef<ParkPoint[] | null>(null);
  const stopsRef = useRef(stops);
  const addedRef = useRef<Set<string>>(new Set(addedParkCodes));
  const markersRef = useRef<MlMarker[]>([]);
  const drawRef = useRef<{ stop: () => void } | null>(null);
  const tripIdRef = useRef(tripId);
  const framedTripRef = useRef<string | null>(null); // last trip id the camera framed — reframe only on switch
  const onMutatedRef = useRef(onMutated);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const { colorMode } = useColorMode();
  const c = brandColors(colorMode);
  const [note, setNote] = useState<string | null>(null);

  stopsRef.current = stops;
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

  // POST addStop for a clicked park, then bubble the new trip + live metrics up to the builder (#9).
  async function addPark(parkCode: string, name: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setNote(`Adding ${name}…`);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripIdRef.current)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'addStop', stop: { kind: 'park', refId: parkCode } }),
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
      setNote(`Added ${name}`);
    } catch {
      /* aborted / network — leave the trip unchanged */
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    if (!ref.current) return;
    registerMapProtocols();
    const ac = new AbortController();
    abortRef.current = ac;
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: ref.current, style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'), bounds: US_BOUNDS, fitBoundsOptions: { padding: 24 } });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[MapTripCanvas] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    mapRef.current = map;

    map.on('load', async () => {
      attachMarkerImages(map); // designation glyphs rendered on demand (#2d)
      const parkColorExpr = ['match', ['get', 'desigKey'], ...designationMatchStops(colorMode), designationDefaultColor(colorMode)] as unknown as ExpressionSpecification;
      map.addSource('canvas-parks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 8, clusterRadius: 50 });
      map.addLayer({ id: 'canvas-clusters', type: 'circle', source: 'canvas-parks', filter: ['has', 'point_count'],
        paint: { 'circle-color': c.pine, 'circle-opacity': 0.8, 'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 30, 26] } });
      map.addLayer({ id: 'canvas-cluster-count', type: 'symbol', source: 'canvas-parks', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12, 'text-font': ['Noto Sans Medium'] }, paint: { 'text-color': '#fff' } });
      map.addLayer({ id: 'canvas-park', type: 'circle', source: 'canvas-parks', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': parkColorExpr, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } });
      map.addLayer({ id: 'canvas-park-icon', type: 'symbol', source: 'canvas-parks', filter: ['!', ['has', 'point_count']],
        layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.55, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });

      // Click an addable park → an "Add to trip" popup (setDOMContent so the button can carry a real handler).
      map.on('mouseenter', 'canvas-park', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'canvas-park', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'canvas-park', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { parkCode: string; name: string; designation?: string };
        const [lng, lat] = (f.geometry as Point).coordinates;
        const root = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = props.name ?? props.parkCode;
        const sub = document.createElement('div');
        sub.style.cssText = 'color:#777;font-size:12px;margin:2px 0 6px';
        sub.textContent = props.designation ?? '';
        const btn = document.createElement('button');
        btn.textContent = 'Add to trip';
        btn.style.cssText = `background:${c.pine};color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer`;
        const popup = new maplibregl.Popup({ closeButton: false }).setLngLat([lng, lat]);
        btn.onclick = () => { addPark(props.parkCode, props.name); popup.remove(); };
        root.append(title, sub, btn);
        popup.setDOMContent(root).addTo(map);
      });
      // Cluster → zoom to expand.
      map.on('click', 'canvas-clusters', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['canvas-clusters'] })[0];
        if (!f) return;
        (map.getSource('canvas-parks') as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id).then((zoom) =>
          map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom }),
        );
      });

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
      applyParks(map);
      renderTripOverlay(map, stopsRef.current, c, markersRef, drawRef, true, true); // frame existing stops on open
      framedTripRef.current = tripIdRef.current;
    });

    return () => {
      drawRef.current?.stop();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      ac.abort();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // Re-paint the addable parks (added set changed) + redraw the route whenever the stops change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    applyParks(map);
    // Reframe only when the active TRIP changed (switched trips) — not when a park was added to the current
    // one (you just clicked it, it's on-screen; yanking the camera mid-build is jarring). (#9, review MEDIUM-3)
    const switched = framedTripRef.current !== tripId;
    renderTripOverlay(map, stops, c, markersRef, drawRef, true, switched);
    framedTripRef.current = tripId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, addedParkCodes]);

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
      {note ? (
        <Box position="absolute" bottom={2} left="50%" transform="translateX(-50%)" bg="bg.panel/95" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="full" px={3} py={1} shadow="sm" fontSize="xs" aria-live="polite">
          <Text>{note}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
