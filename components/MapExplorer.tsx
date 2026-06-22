'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Stack, Checkbox, Text, Spinner, HStack } from '@chakra-ui/react';
import { mapStyle, US_CENTER, US_BOUNDS, registerMapProtocols, attachBasemapFallback } from '../lib/mapStyle';
import { useColorMode } from './ui/color-mode';
import type { ParkSummary } from '../lib/queries';

/**
 * Global park map (B1-B2) + layer toggles (B3): campgrounds, visitor centers, things-to-do, and
 * active-alert parks, each lazily loaded per viewport (point.withinBBox, §12.4). Click a point → popup.
 */
const POI_LAYERS = [
  { key: 'campgrounds', label: 'Campgrounds', color: '#2f9e44' },
  { key: 'visitorcenters', label: 'Visitor centers', color: '#9c36b5' },
  { key: 'thingstodo', label: 'Things to do', color: '#e8590c' },
  { key: 'alerts', label: 'Active alerts', color: '#e03131' },
] as const;

type LayerKey = (typeof POI_LAYERS)[number]['key'];

export function MapExplorer({ initialBounds }: { initialBounds?: [[number, number], [number, number]] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const { colorMode } = useColorMode();
  // Default the Campgrounds layer on (§2.11) so the map isn't empty on first load.
  const enabledRef = useRef<Record<string, boolean>>({ campgrounds: true });
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ campgrounds: true });
  // In-flight fetch count → a loading indicator while clusters/POIs load (R3 §4.4): without this the
  // map looks empty for several seconds after the basemap paints.
  const pendingRef = useRef(0);
  const [loading, setLoading] = useState(false);

  function begin() {
    pendingRef.current += 1;
    setLoading(true);
  }
  function end() {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current === 0) setLoading(false);
  }

  function bboxParams(map: MlMap, extra: Record<string, string> = {}) {
    const b = map.getBounds();
    return new URLSearchParams({
      op: 'bbox',
      minLat: String(b.getSouth()),
      minLng: String(b.getWest()),
      maxLat: String(b.getNorth()),
      maxLng: String(b.getEast()),
      ...extra,
    });
  }

  async function loadParks(map: MlMap) {
    begin();
    try {
      const res = await fetch(`/api/graph?${bboxParams(map)}`);
      const { parks } = (await res.json()) as { parks: ParkSummary[] };
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: (parks ?? [])
          .filter((p) => p.lat != null && p.lng != null)
          .map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng as number, p.lat as number] },
            properties: { parkCode: p.parkCode, name: p.name, designation: p.designation },
          })),
      };
      (map.getSource('parks') as GeoJSONSource | undefined)?.setData(fc);
    } catch {
      /* keep existing data */
    } finally {
      end();
    }
  }

  async function loadPoiLayer(map: MlMap, key: LayerKey) {
    begin();
    try {
      const res = await fetch(`/api/graph?${bboxParams(map, { layer: key })}`);
      const { items } = (await res.json()) as { items: { id?: string; parkCode?: string; name: string; lat: number; lng: number }[] };
      const fc: FeatureCollection = {
        type: 'FeatureCollection',
        features: (items ?? [])
          .filter((i) => i.lat != null && i.lng != null)
          .map((i) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [i.lng, i.lat] },
            properties: { id: i.id ?? i.parkCode ?? '', name: i.name, parkCode: i.parkCode ?? '' },
          })),
      };
      (map.getSource(`poi-${key}`) as GeoJSONSource | undefined)?.setData(fc);
    } catch {
      /* keep existing */
    } finally {
      end();
    }
  }

  function loadAll(map: MlMap) {
    loadParks(map);
    for (const { key } of POI_LAYERS) if (enabledRef.current[key]) loadPoiLayer(map, key);
  }

  // Toggle a layer's visibility + (re)load when enabled.
  function toggleLayer(key: LayerKey, on: boolean) {
    const next = { ...enabledRef.current, [key]: on };
    enabledRef.current = next;
    setEnabled(next);
    const map = mapRef.current;
    if (!map) return;
    map.setLayoutProperty(`poi-${key}`, 'visibility', on ? 'visible' : 'none');
    if (on) loadPoiLayer(map, key);
  }

  useEffect(() => {
    if (!ref.current) return;
    registerMapProtocols();
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: ref.current, style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'), center: US_CENTER, zoom: 3.2 });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[MapExplorer] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

    map.on('load', () => {
      map.addSource('parks', { type: 'geojson', data: emptyFC(), cluster: true, clusterMaxZoom: 8, clusterRadius: 50 });
      map.addLayer({ id: 'clusters', type: 'circle', source: 'parks', filter: ['has', 'point_count'],
        paint: { 'circle-color': '#1971c2', 'circle-opacity': 0.8, 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 30, 30] } });
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'parks', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 }, paint: { 'text-color': '#fff' } });
      map.addLayer({ id: 'park-point', type: 'circle', source: 'parks', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': '#1971c2', 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } });

      // One empty source+layer per POI layer (hidden until toggled).
      for (const { key, color } of POI_LAYERS) {
        map.addSource(`poi-${key}`, { type: 'geojson', data: emptyFC() });
        map.addLayer({ id: `poi-${key}`, type: 'circle', source: `poi-${key}`,
          layout: { visibility: 'none' },
          paint: { 'circle-color': color, 'circle-radius': 5, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
        map.on('click', `poi-${key}`, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const props = f.properties as { name: string; parkCode: string };
          const [lng, lat] = (f.geometry as Point).coordinates;
          const link = props.parkCode ? `<br/><a href="/parks/${props.parkCode}" style="color:#1971c2">View park →</a>` : '';
          new maplibregl.Popup().setLngLat([lng, lat]).setHTML(`<strong>${props.name}</strong>${link}`).addTo(map);
        });
      }

      map.on('click', 'clusters', (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
        (map.getSource('parks') as GeoJSONSource).getClusterExpansionZoom(f.properties?.cluster_id).then((zoom) =>
          map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom }),
        );
      });
      map.on('click', 'park-point', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as { parkCode: string; name: string; designation: string };
        const [lng, lat] = (f.geometry as Point).coordinates;
        new maplibregl.Popup().setLngLat([lng, lat]).setHTML(
          `<strong>${p.name}</strong><br/><span style="color:#666">${p.designation ?? ''}</span><br/><a href="/parks/${p.parkCode}" style="color:#1971c2">View park →</a>`,
        ).addTo(map);
      });

      // Show layers that default on, then fit the continental US (§2.11).
      for (const { key } of POI_LAYERS) {
        if (enabledRef.current[key]) map.setLayoutProperty(`poi-${key}`, 'visibility', 'visible');
      }
      // Center on the user's considered parks when we have them (R4 §4), else the continental US.
      map.fitBounds(initialBounds ?? US_BOUNDS, { padding: initialBounds ? 64 : 20, maxZoom: 9, duration: 0 });
      loadAll(map);
      map.on('moveend', () => loadAll(map));
    });

    return () => map.remove();
    // Re-init on color-mode change so the basemap matches light/dark (R4 §2.5); the 'load' handler
    // re-adds the cluster + POI layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  return (
    <>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} aria-label="Map of National Park Service sites" role="application" />
      {loading ? (
        <HStack
          position="absolute"
          top={3}
          left="50%"
          transform="translateX(-50%)"
          bg="bg.panel"
          borderWidth="1px"
          borderRadius="full"
          px={3}
          py={1.5}
          shadow="md"
          gap={2}
          aria-live="polite"
        >
          <Spinner size="sm" color="blue.500" />
          <Text fontSize="xs" color="fg.muted">Loading map data…</Text>
        </HStack>
      ) : null}
      <Box position="absolute" top={3} left={3} bg="bg.panel" borderWidth="1px" borderRadius="md" p={3} shadow="md">
        <Text fontSize="xs" fontWeight="semibold" mb={2}>Layers</Text>
        <Stack gap={1}>
          {POI_LAYERS.map(({ key, label, color }) => (
            <Checkbox.Root key={key} size="sm" checked={!!enabled[key]} onCheckedChange={(d) => toggleLayer(key, !!d.checked)}>
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>
                <Box as="span" display="inline-block" w="8px" h="8px" borderRadius="full" bg={color} mr={2} />
                {label}
              </Checkbox.Label>
            </Checkbox.Root>
          ))}
        </Stack>
      </Box>
    </>
  );
}

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
