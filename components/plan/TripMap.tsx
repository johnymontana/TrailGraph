'use client';
import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle, US_CENTER, registerMapProtocols, attachBasemapFallback } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors, type BrandColors } from '../../lib/brandColors';

/** Itinerary overlay (B4): numbered stop markers + a route line for the selected trip. */
export interface TripMapStop {
  lat: number | null;
  lng: number | null;
  label: string;
  order: number;
}

export function TripMap({ stops }: { stops: TripMapStop[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const stopsRef = useRef(stops);
  const { colorMode } = useColorMode();
  const c = brandColors(colorMode);
  stopsRef.current = stops;

  useEffect(() => {
    if (!ref.current) return;
    registerMapProtocols();
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: ref.current, style: mapStyle(colorMode === 'dark' ? 'dark' : 'light'), center: US_CENTER, zoom: 3 });
      attachBasemapFallback(map);
    } catch (err) {
      console.warn('[TripMap] map unavailable (WebGL?):', (err as Error).message);
      return;
    }
    mapRef.current = map;
    map.on('load', () => render(map, stopsRef.current, c));
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // Re-render markers/line when stops change.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) render(map, stops, c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  return <div ref={ref} style={{ width: '100%', height: '260px', borderRadius: 8, overflow: 'hidden' }} aria-label="Trip itinerary map" role="application" />;
}

function render(map: MlMap, stops: TripMapStop[], c: BrandColors) {
  const located = stops.filter(
    (s): s is TripMapStop & { lat: number; lng: number } => s.lat != null && s.lng != null,
  );
  const coords = located.map((s) => [s.lng, s.lat] as [number, number]);

  // Route line
  const lineData = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } as const;
  if (map.getSource('trip-line')) {
    (map.getSource('trip-line') as maplibregl.GeoJSONSource).setData(lineData);
  } else {
    map.addSource('trip-line', { type: 'geojson', data: lineData });
    map.addLayer({ id: 'trip-line', type: 'line', source: 'trip-line', paint: { 'line-color': c.pine, 'line-width': 3, 'line-dasharray': [2, 1] } });
  }

  // Clear old markers and add numbered ones.
  document.querySelectorAll('.trip-stop-marker').forEach((el) => el.remove());
  located.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'trip-stop-marker';
    el.textContent = String(i + 1);
    Object.assign(el.style, {
      background: c.pine, color: '#fff', borderRadius: '50%', width: '22px', height: '22px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600',
      border: '2px solid #fff',
    });
    new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(new maplibregl.Popup().setText(s.label)).addTo(map);
  });

  if (coords.length === 1) {
    map.easeTo({ center: coords[0], zoom: 7 });
  } else if (coords.length > 1) {
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 40, maxZoom: 9, duration: 400 });
  }
}
