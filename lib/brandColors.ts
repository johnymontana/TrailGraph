/**
 * Resolved brand colors for the NON-React surfaces that can't read Chakra CSS-variable tokens: MapLibre
 * paint layers, Neo4j NVL node/edge colors, popup inline HTML, and the placeholder gradient. Derived from
 * the same raw scales as the Chakra theme (theme/colors.ts) so the canvas/WebGL chrome always matches the
 * themed React UI in both color modes.
 *
 * Usage: `const c = brandColors(colorMode)` inside a client component that has `useColorMode()`, then pass
 * `c.pine`, `c.trail`, etc. into map/graph style objects.
 */
import type { ColorMode } from '../components/ui/color-mode';
import { ink, pine, sand, trail } from '../theme/colors';

export interface BrandColors {
  /** Primary brand (campgrounds, graph hub, trip routes). */
  pine: string;
  /** Accent (visitor centers, "your parks", AI highlights). */
  trail: string;
  /** Things-to-do / secondary POI. */
  trailLight: string;
  /** Danger/alerts (kept red for legibility). */
  danger: string;
  /** Faded/inactive nodes + map muted text. */
  faded: string;
  /** Marker/label contrast (text on a colored marker). */
  onColor: string;
  /** Surface behind floating panels / map controls. */
  surface: string;
}

const light: BrandColors = {
  pine: pine[600],
  trail: trail[500],
  trailLight: trail[300],
  danger: '#E03131',
  faded: sand[400],
  onColor: '#FFFFFF',
  surface: sand[50],
};

const dark: BrandColors = {
  pine: pine[400],
  trail: trail[400],
  trailLight: trail[300],
  danger: '#FF6B6B',
  faded: sand[700],
  onColor: ink.canvas,
  surface: ink.panel,
};

export function brandColors(mode: ColorMode | undefined): BrandColors {
  return mode === 'dark' ? dark : light;
}
