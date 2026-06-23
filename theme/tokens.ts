/**
 * Raw design tokens for the TrailGraph "Topographic Adventure" system. These are concrete values that
 * semantic tokens (theme/semantic-tokens.ts) and recipes reference. Fonts resolve to the `next/font` CSS
 * variables wired in app/layout.tsx.
 */
import { defineTokens } from '@chakra-ui/react';
import { pine, sand, trail } from './colors';

/** Turn a plain `{ 50: '#..' }` scale into Chakra `{ 50: { value: '#..' } }` token form. */
function scale(s: Record<number, string>) {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { value: v }]));
}

export const tokens = defineTokens({
  colors: {
    pine: scale(pine),
    trail: scale(trail),
    sand: scale(sand),
  },
  fonts: {
    // Bricolage Grotesque (display) + Inter (body) wired as next/font CSS vars in app/layout.tsx.
    heading: { value: 'var(--font-display), ui-sans-serif, system-ui, sans-serif' },
    body: { value: 'var(--font-body), ui-sans-serif, system-ui, sans-serif' },
    mono: { value: 'var(--font-mono), ui-monospace, SFMono-Regular, monospace' },
  },
  radii: {
    l1: { value: '0.5rem' },
    l2: { value: '0.75rem' },
    l3: { value: '1rem' },
  },
  shadows: {
    // Soft, warm-tinted elevation (not the default cool gray) — reads "outdoorsy paper".
    xs: { value: '0 1px 2px rgba(46, 41, 30, 0.06)' },
    sm: { value: '0 1px 3px rgba(46, 41, 30, 0.10), 0 1px 2px rgba(46, 41, 30, 0.06)' },
    md: { value: '0 4px 12px rgba(46, 41, 30, 0.10), 0 2px 4px rgba(46, 41, 30, 0.06)' },
    lg: { value: '0 12px 28px rgba(46, 41, 30, 0.14), 0 4px 8px rgba(46, 41, 30, 0.06)' },
    xl: { value: '0 24px 56px rgba(46, 41, 30, 0.18)' },
  },
});
