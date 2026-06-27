'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle, registerMapProtocols, attachBasemapFallback } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors } from '../../lib/brandColors';

/** Difficulty → line color (canvas can't read CSS tokens, like brandColors/mapLenses). */
const DIFF_HEX: Record<string, string> = { easy: '#2f9e44', moderate: '#e8a317', strenuous: '#d6451f' };

/**
 * Trail detail route map (ADR-066): draws the trail's simplified MultiLineString (colored by difficulty) +
 * a trailhead marker, fit to the geometry. Mirrors `components/MiniMap.tsx` (self-hosted basemap, graceful
 * WebGL fallback). Geometry comes from the park's Blob FC, read server-side and passed in.
 */
export function TrailRouteMap({
  geometry,
  trailheadLat,
  trailheadLng,
  difficulty,
}: {
  geometry: GeoJSON.MultiLineString;
  trailheadLat: number | null;
  trailheadLng: number | null;
  difficulty: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { colorMode } = useColorMode();
  useEffect(() => {
    if (!ref.current) return;
    const first = geometry.coordinates[0]?.[0];
    if (!first) return;
    const c = brandColors(colorMode);
    const lineColor = DIFF_HEX[difficulty ?? ''] ?? c.pine;
    registerMapProtocols();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'),
        center: [trailheadLng ?? first[0], trailheadLat ?? first[1]],
        zoom: 12,
        attributionControl: { compact: true },
      });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[TrailRouteMap] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    const m = map;
    m.on('load', () => {
      if (!m.getStyle()) return;
      m.addSource('trail', { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } });
      m.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': lineColor, 'line-width': 4 },
      });
      if (trailheadLat != null && trailheadLng != null) {
        new maplibregl.Marker({ color: c.pine })
          .setLngLat([trailheadLng, trailheadLat])
          .setPopup(new maplibregl.Popup().setText('Trailhead'))
          .addTo(m);
      }
      try {
        const b = new maplibregl.LngLatBounds();
        for (const line of geometry.coordinates) for (const [lng, lat] of line) b.extend([lng, lat]);
        if (!b.isEmpty()) m.fitBounds(b, { padding: 32, maxZoom: 14, duration: 0 });
      } catch {
        /* keep the default center if bounds math fails */
      }
    });
    return () => map.remove();
  }, [geometry, trailheadLat, trailheadLng, difficulty, colorMode]);

  return <div ref={ref} style={{ width: '100%', height: '320px', borderRadius: 8, overflow: 'hidden' }} />;
}
