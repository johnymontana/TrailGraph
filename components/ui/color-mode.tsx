'use client';
import { ThemeProvider, useTheme, type ThemeProviderProps } from 'next-themes';

/**
 * Chakra UI v3 color-mode provider — the official App Router pattern. ColorMode is driven by
 * `next-themes` writing a `class` on <html> (matches Chakra's `.dark &` token condition); the root
 * layout sets `suppressHydrationWarning` because that class is written before React hydrates.
 *
 * Fresh visitors follow their OS preference (`defaultTheme="system"` + `enableSystem`); the nav toggle
 * (`ColorModeButton`) stores an explicit, persistent choice. Any component that renders theme-dependent
 * markup must gate on a mounted flag (see `color-mode-button.tsx`) so SSR === first CSR (R4 §2.2).
 */
export type ColorModeProviderProps = ThemeProviderProps;

export function ColorModeProvider(props: ColorModeProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    />
  );
}

export type ColorMode = 'light' | 'dark';

export function useColorMode() {
  const { resolvedTheme, setTheme, forcedTheme } = useTheme();
  const colorMode = (forcedTheme || resolvedTheme) as ColorMode;
  const toggleColorMode = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  return { colorMode, setColorMode: setTheme, toggleColorMode };
}

export function useColorModeValue<T>(light: T, dark: T): T {
  const { colorMode } = useColorMode();
  return colorMode === 'dark' ? dark : light;
}
