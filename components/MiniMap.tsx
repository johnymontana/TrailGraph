'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle, registerMapProtocols, attachBasemapFallback } from '../lib/mapStyle';
import { useColorMode } from './ui/color-mode';

/** A small single-marker map for the park detail page (A2 mini-map). With `parkCode`, it also overlays
 * the park's real boundary polygon (NPS-expansion P1 #4) fetched on demand from the cached API route. */
export function MiniMap({ lat, lng, label, parkCode }: { lat: number; lng: number; label: string; parkCode?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { colorMode } = useColorMode();
  useEffect(() => {
    if (!ref.current) return;
    registerMapProtocols();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current,
        style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'),
        center: [lng, lat],
        zoom: 7,
        attributionControl: { compact: true },
      });
      attachBasemapFallback(map);
      new maplibregl.Marker({ color: '#1971c2' }).setLngLat([lng, lat]).setPopup(new maplibregl.Popup().setText(label)).addTo(map);
    } catch (err) {
      console.warn('[MiniMap] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    // Boundary overlay: fetch GeoJSON from the cached route, add a translucent fill + outline, fit to it.
    if (parkCode) {
      const m = map;
      m.on('load', () => {
        fetch(`/api/parkboundary/${parkCode}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((geo: GeoJSON.GeoJSON | null) => {
            if (!geo || !('features' in geo) || geo.features.length === 0 || !m.getStyle()) return;
            m.addSource('park-boundary', { type: 'geojson', data: geo });
            m.addLayer({ id: 'park-boundary-fill', type: 'fill', source: 'park-boundary', paint: { 'fill-color': '#2f9e44', 'fill-opacity': 0.12 } });
            m.addLayer({ id: 'park-boundary-line', type: 'line', source: 'park-boundary', paint: { 'line-color': '#2f9e44', 'line-width': 2 } });
            try {
              const b = new maplibregl.LngLatBounds();
              const extend = (coords: GeoJSON.Position[]) => coords.forEach((c) => b.extend([c[0], c[1]]));
              for (const f of geo.features) {
                const g = f.geometry;
                if (g.type === 'Polygon') g.coordinates.forEach(extend);
                else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => poly.forEach(extend));
              }
              if (!b.isEmpty()) m.fitBounds(b, { padding: 24, maxZoom: 10, duration: 0 });
            } catch {
              /* keep the default center if bounds math fails */
            }
          })
          .catch(() => {});
      });
    }
    return () => map.remove();
  }, [lat, lng, label, parkCode, colorMode]);

  return <div ref={ref} style={{ width: '100%', height: '260px', borderRadius: 8, overflow: 'hidden' }} />;
}
