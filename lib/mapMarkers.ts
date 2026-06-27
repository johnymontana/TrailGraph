import type { Map as MlMap } from 'maplibre-gl';

/**
 * Marker glyphs (#2d): simple 24×24 white silhouettes drawn to a canvas and registered as MapLibre images,
 * so the park/POI symbol layers can show a SHAPE per designation / POI type while the circle underneath
 * carries the color (designation #2 or a data lens #3). Image ids are `mk-<shape>`; MapLibre fires
 * `styleimagemissing` when a layer references one that isn't loaded (initial paint + after every setStyle,
 * which wipes images), and we render it on demand — so there's no separate load step to keep in sync.
 */
export const MARKER_SVGS: Record<string, string> = {
  // designation shapes
  mountain: 'M2 19 L8 7 L12 13 L15 9 L22 19 Z',
  monument: 'M11 3 L13 3 L12.4 15 L11.6 15 Z M9 15 H15 V19 H9 Z',
  landmark: 'M3 10 L12 4 L21 10 L21 12 L3 12 Z M5 13 H7 V19 H5 Z M11 13 H13 V19 H11 Z M17 13 H19 V19 H17 Z M2 20 H22 V22 H2 Z',
  wave: 'M2 13 Q5 9 8 13 T14 13 T20 13 Q21 12 22 13 V18 H2 Z',
  leaf: 'M12 3 C6 6 5 13 7 19 C13 18 18 11 17 4 C15.5 3.3 13.7 3 12 3 Z',
  binoculars: 'M6 8 a4 4 0 1 0 0 8 a4 4 0 1 0 0 -8 Z M18 8 a4 4 0 1 0 0 8 a4 4 0 1 0 0 -8 Z M8 11 H16 V13 H8 Z',
  pin: 'M12 2 C8 2 5 5 5 9 C5 14 12 22 12 22 C12 22 19 14 19 9 C19 5 16 2 12 2 Z',
  // POI shapes
  tent: 'M12 4 L21 19 H14 L12 15 L10 19 H3 Z',
  info: 'M12 2 a10 10 0 1 0 0 20 a10 10 0 1 0 0 -20 Z M11 6 H13 V9 H11 Z M11 10 H13 V17 H11 Z',
  star: 'M12 2 L15 9 L22 9 L16 14 L18 21 L12 17 L6 21 L8 14 L2 9 L9 9 Z',
  alert: 'M12 3 L22 20 H2 Z M11 9 H13 V14 H11 Z M11 16 H13 V18 H11 Z',
  footprints: 'M8 5 a2 2.6 0 1 0 0.01 0 Z M8 10.6 a1.5 1.8 0 1 0 0.01 0 Z M16 9 a2 2.6 0 1 0 0.01 0 Z M16 14.6 a1.5 1.8 0 1 0 0.01 0 Z',
};

export const markerImageId = (shape: string): string => `mk-${shape}`;

const SIZE = 26; // CSS px
const RATIO = 2; // device pixels per CSS px → crisp at marker size

/** Render one white-silhouette marker image and register it as `mk-<shape>` (idempotent; client-only). */
export function addMarkerImage(map: MlMap, id: string): void {
  if (typeof document === 'undefined' || map.hasImage(id)) return;
  const shape = id.replace(/^mk-/, '');
  const path = MARKER_SVGS[shape] ?? MARKER_SVGS.pin;
  const px = SIZE * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Scale the 24-unit viewBox into the canvas with a little padding, centered.
  const s = (px / 24) * 0.82;
  ctx.setTransform(s, 0, 0, s, px * 0.09, px * 0.09);
  ctx.fillStyle = '#ffffff';
  try {
    ctx.fill(new Path2D(path), 'evenodd');
  } catch {
    return;
  }
  const data = ctx.getImageData(0, 0, px, px);
  map.addImage(id, data, { pixelRatio: RATIO });
}

/** Attach the on-demand renderer for any `mk-*` image a layer asks for (survives setStyle image wipes). */
export function attachMarkerImages(map: MlMap): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (e.id.startsWith('mk-')) addMarkerImage(map, e.id);
  });
}
