'use client';
import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap, type Marker as MlMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { animate } from 'motion/react';
import { mapStyle, US_CENTER, registerMapProtocols, attachBasemapFallback } from '../../lib/mapStyle';
import { useColorMode } from '../ui/color-mode';
import { brandColors, type BrandColors } from '../../lib/brandColors';
import { durations, easings, stagger } from '../../theme/motion';
import { lineSlice, type Coord } from '../../lib/route-geometry';

/** Itinerary overlay (B4): numbered stop markers + a route line for the selected trip. */
export interface TripMapStop {
  lat: number | null;
  lng: number | null;
  label: string;
  order: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function TripMap({ stops }: { stops: TripMapStop[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const stopsRef = useRef(stops);
  const markersRef = useRef<MlMarker[]>([]);
  const drawRef = useRef<{ stop: () => void } | null>(null);
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
    map.on('load', () => render(map, stopsRef.current, c, markersRef, drawRef, true));
    return () => {
      drawRef.current?.stop();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  // Re-render markers/line when stops change — and re-draw the route so the plan visibly assembles.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) render(map, stops, c, markersRef, drawRef, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  return <div ref={ref} style={{ width: '100%', height: '260px', borderRadius: 8, overflow: 'hidden' }} aria-label="Trip itinerary map" role="application" />;
}

function render(
  map: MlMap,
  stops: TripMapStop[],
  c: BrandColors,
  markersRef: React.MutableRefObject<MlMarker[]>,
  drawRef: React.MutableRefObject<{ stop: () => void } | null>,
  withAnimation: boolean,
) {
  const located = stops.filter(
    (s): s is TripMapStop & { lat: number; lng: number } => s.lat != null && s.lng != null,
  );
  const coords: Coord[] = located.map((s) => [s.lng, s.lat]);
  const fullData = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } as const;
  const setLine = (cs: Coord[]) => {
    const src = map.getSource('trip-line') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: cs } });
  };

  // Ensure the source/layer exist.
  if (map.getSource('trip-line')) {
    (map.getSource('trip-line') as maplibregl.GeoJSONSource).setData(fullData);
  } else {
    map.addSource('trip-line', { type: 'geojson', data: fullData });
    map.addLayer({ id: 'trip-line', type: 'line', source: 'trip-line', paint: { 'line-color': c.pine, 'line-width': 3, 'line-dasharray': [2, 1] } });
  }

  // Route-drawing (ADR-048/§7.3): grow the polyline 0→1; reduced-motion / trivial routes snap to full.
  drawRef.current?.stop();
  const reduced = prefersReducedMotion();
  if (withAnimation && !reduced && coords.length > 1) {
    setLine([coords[0]]);
    drawRef.current = animate(0, 1, {
      duration: durations.draw * 1.6,
      ease: easings.standard,
      onUpdate: (v: number) => setLine(lineSlice(coords, v)),
      onComplete: () => setLine(coords),
    });
  } else {
    setLine(coords);
  }

  // Per-instance marker cleanup (fix: the old global `.trip-stop-marker` querySelectorAll wiped a second
  // TripMap's markers too). Staggered drop-in unless reduced motion.
  markersRef.current.forEach((m) => m.remove());
  markersRef.current = [];
  located.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'trip-stop-marker';
    el.textContent = String(i + 1);
    Object.assign(el.style, {
      background: c.pine, color: '#fff', borderRadius: '50%', width: '22px', height: '22px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600',
      border: '2px solid #fff',
    });
    if (withAnimation && !reduced && coords.length > 1) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      el.style.transition = `opacity ${durations.base}s ease, transform ${durations.base}s cubic-bezier(${easings.standard.join(',')})`;
      const delay = i * stagger.base * 1000;
      window.setTimeout(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, delay);
    }
    const marker = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).setPopup(new maplibregl.Popup().setText(s.label)).addTo(map);
    markersRef.current.push(marker);
  });

  if (coords.length === 1) {
    map.easeTo({ center: coords[0], zoom: 7 });
  } else if (coords.length > 1) {
    const bounds = coords.reduce((b, cur) => b.extend(cur), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 40, maxZoom: 9, duration: 400 });
  }
}
