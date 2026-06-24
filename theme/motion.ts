/**
 * Motion tokens (ADR-044) — the single source of truth for every `motion` (Framer successor) usage.
 * A plain TS module (NOT a Chakra `createSystem` slice): these feed `motion` props, not CSS vars, the
 * same way `lib/brandColors.ts` lives outside the Chakra system for canvas/WebGL surfaces. Durations are
 * seconds (Framer's unit). Keep all motion client-side and reduced-motion-first (a global
 * `<MotionConfig reducedMotion="user">` collapses transforms/opacity/layout to their end-state; SVG
 * `pathLength` draws — which MotionConfig does NOT auto-handle — branch on `useReducedMotion()`).
 */
export const durations = {
  instant: 0,
  fast: 0.15,
  base: 0.22,
  slow: 0.4,
  draw: 0.8,
} as const;

export const easings = {
  standard: [0.2, 0, 0, 1],
  emphasized: [0.05, 0.7, 0.1, 1],
} as const;

export const springs = {
  gentle: { type: 'spring', stiffness: 120, damping: 18, mass: 1 },
  snappy: { type: 'spring', stiffness: 320, damping: 26, mass: 0.8 },
  bouncy: { type: 'spring', stiffness: 260, damping: 16, mass: 0.9 }, // node spring-in (memory-forming)
  morph: { type: 'spring', stiffness: 280, damping: 30, mass: 1 }, // layout / hero morph
} as const;

export const stagger = {
  tight: 0.04,
  base: 0.07,
  loose: 0.12,
} as const;

/** Tween for SVG path-drawing (pathLength 0→1) — edge draws, route traces. */
export const draw = { duration: durations.draw, ease: easings.emphasized } as const;
