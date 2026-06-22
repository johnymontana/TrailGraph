'use client';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { ColorModeProvider } from '../components/ui/color-mode';

/**
 * Chakra UI v3 — the official Next.js App Router provider.
 *
 * We deliberately do NOT hand-roll an `@emotion/cache` + `useServerInsertedHTML` registry. The earlier
 * registry (with `cache.compat = true` and a manual flush) desynced Emotion's `registered` map between
 * server and client, so `serializeStyles` hashed a *different input* per element → the recurring
 * `css-…` class mismatch on `fg.muted` text (QA R1–R3). Letting Chakra's own Emotion path manage SSR
 * (one Emotion copy in the tree, confirmed via `pnpm why`) makes the class names match. Color mode is
 * handled by `ColorModeProvider` (next-themes); `<html suppressHydrationWarning>` lives in layout.tsx.
 */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={defaultSystem}>
      <ColorModeProvider>{children}</ColorModeProvider>
    </ChakraProvider>
  );
}
