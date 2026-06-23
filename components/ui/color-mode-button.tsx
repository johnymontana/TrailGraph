'use client';
import { useEffect, useState } from 'react';
import { IconButton, type IconButtonProps } from '@chakra-ui/react';
import { LuMoon, LuSun } from 'react-icons/lu';
import { useColorMode } from './color-mode';

/**
 * Light/dark toggle for the nav (R4 §2.2). The resolved theme is unknown on the server, so rendering a
 * theme-dependent icon on first paint would create a NEW hydration mismatch — we gate on a `mounted`
 * flag and show a neutral placeholder icon until then, so SSR === first CSR.
 */
export function ColorModeButton(props: Omit<IconButtonProps, 'aria-label'>) {
  const { colorMode, toggleColorMode } = useColorMode();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <IconButton
      aria-label={mounted ? `Switch to ${colorMode === 'dark' ? 'light' : 'dark'} mode` : 'Toggle color mode'}
      variant="ghost"
      size="sm"
      color="fg.muted"
      onClick={toggleColorMode}
      suppressHydrationWarning
      {...props}
    >
      {/* Both gated on `mounted`; until then show the moon as a stable neutral placeholder. */}
      {mounted && colorMode === 'dark' ? <LuSun /> : <LuMoon />}
    </IconButton>
  );
}
