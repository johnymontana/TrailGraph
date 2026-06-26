import maplibregl, { type Map as MlMap, type Marker as MlMarker } from 'maplibre-gl';
import { animate } from 'motion/react';
import { durations, easings, stagger } from '../theme/motion';
import { lineSlice, type Coord } from './route-geometry';
import type { BrandColors } from './brandColors';

/**
 * Shared trip-route overlay renderer (#9): the numbered stop markers + the growing route polyline that both
 * the read-only `TripMap` preview and the interactive `MapTripCanvas` build-on-map surface draw. Extracted
 * from `TripMap` so the two never drift. Browser-only (creates DOM markers, runs a motion animation) — call
 * it from a client component inside `map.on('load')` / a stops effect. Operates on the passed `map`, mutating
 * the `trip-line` source/layer + the caller's marker/draw refs; idempotent across re-renders.
 */
export interface TripMapStop {
  lat: number | null;
  lng: number | null;
  label: string;
  order: number;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function renderTripOverlay(
  map: MlMap,
  stops: TripMapStop[],
  c: BrandColors,
  markersRef: { current: MlMarker[] },
  drawRef: { current: { stop: () => void } | null },
  withAnimation: boolean,
  // The read-only preview reframes on every change; the build-on-map canvas passes false after the initial
  // render so adding a park (already on-screen, just clicked) doesn't yank the camera mid-browse (#9).
  fitCamera = true,
) {
  const located = stops.filter(
    (s): s is TripMapStop & { lat: number; lng: number } => s.lat != null && s.lng != null,
  );
  const coords: Coord[] = located.map((s) => [s.lng, s.lat]);
  // GeoJSON spec: LineString requires ≥2 positions. Use an empty FeatureCollection when there are fewer.
  const safeData = (cs: Coord[]) =>
    cs.length >= 2
      ? { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: cs } }
      : { type: 'FeatureCollection' as const, features: [] as never[] };
  const fullData = safeData(coords);
  const setLine = (cs: Coord[]) => {
    const src = map.getSource('trip-line') as maplibregl.GeoJSONSource | undefined;
    src?.setData(safeData(cs));
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

  if (!fitCamera) return;
  if (coords.length === 1) {
    map.easeTo({ center: coords[0], zoom: 7 });
  } else if (coords.length > 1) {
    const bounds = coords.reduce((b, cur) => b.extend(cur), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 40, maxZoom: 9, duration: 400 });
  }
}
