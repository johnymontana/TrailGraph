'use client';
import { useEffect, useState } from 'react';
import { IconButton, type IconButtonProps } from '@chakra-ui/react';
import { useColorMode } from './color-mode';

/**
 * Light/dark toggle for the nav (R4 §2.2). The resolved theme is unknown on the server, so rendering a
 * theme-dependent icon on first paint would create a NEW hydration mismatch — we gate on a `mounted`
 * flag and show a neutral placeholder until then, so SSR === first CSR. Emoji (no icon dep), matching
 * the `☰` hamburger.
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
      onClick={toggleColorMode}
      suppressHydrationWarning
      {...props}
    >
      <span suppressHydrationWarning>{!mounted ? '🌗' : colorMode === 'dark' ? '☀️' : '🌙'}</span>
    </IconButton>
  );
}
