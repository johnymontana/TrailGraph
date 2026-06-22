'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapStyle, registerMapProtocols, attachBasemapFallback } from '../lib/mapStyle';
import { useColorMode } from './ui/color-mode';

/** A small single-marker map for the park detail page (A2 mini-map). */
export function MiniMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
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
    return () => map.remove();
  }, [lat, lng, label, colorMode]);

  return <div ref={ref} style={{ width: '100%', height: '260px', borderRadius: 8, overflow: 'hidden' }} />;
}
