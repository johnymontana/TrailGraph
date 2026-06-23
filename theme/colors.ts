/**
 * Raw brand color scales — the single source of truth for the "Topographic Adventure" palette.
 *
 * Kept as plain hex (no Chakra/React imports) so BOTH consumers derive from the same constants and can
 * never drift:
 *   - `theme/tokens.ts` wraps these in Chakra `{ value }` token objects.
 *   - `lib/brandColors.ts` resolves them for the non-React canvas/WebGL surfaces (MapLibre paint, Neo4j
 *     NVL nodes/edges, the placeholder gradient) which can't read CSS custom-property tokens.
 *
 * Deep pine green = brand/primary. Trail orange = accent / AI-ranger highlight. Warm sand = neutrals.
 */

/** Pine green — primary brand (actions, nav, links). */
export const pine = {
  50: '#EAF2EC',
  100: '#CFE3D6',
  200: '#A6CDB3',
  300: '#74B08C',
  400: '#459268',
  500: '#2E7D52',
  600: '#1B5E3F',
  700: '#134A31',
  800: '#0F3A27',
  900: '#0B2E1E',
  950: '#061C12',
} as const;

/** Trail orange — accent (AI ranger, "for you", highlights). */
export const trail = {
  50: '#FDF0E8',
  100: '#FBD9C5',
  200: '#F6B594',
  300: '#F19461',
  400: '#EC7C3D',
  500: '#E8702A',
  600: '#C85A1C',
  700: '#A24717',
  800: '#7E3814',
  900: '#5C2A11',
  950: '#371708',
} as const;

/** Warm sand — parchment neutrals (light-mode backgrounds, borders, muted text). */
export const sand = {
  50: '#FAF7F0',
  100: '#F5F0E6',
  200: '#EBE4D4',
  300: '#DDD3BD',
  400: '#C7BA9C',
  500: '#AB9B77',
  600: '#8A7B5C',
  700: '#6B5F47',
  800: '#4A4231',
  900: '#2E291E',
  950: '#1A1711',
} as const;

/** Warm near-black "ink" — dark-mode canvas/panel surfaces (slightly green-warm, not pure gray). */
export const ink = {
  canvas: '#14130F',
  panel: '#1C1A15',
  subtle: '#252219',
  muted: '#2F2B20',
  border: '#343024',
  borderSubtle: '#2A2720',
} as const;

export type ColorScale = typeof pine;
