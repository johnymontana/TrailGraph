'use client';
import { Box, Flex, Link as CLink, Spacer, Menu, IconButton } from '@chakra-ui/react';
import NextLink from 'next/link';
import { ColorModeButton } from './ui/color-mode-button';

const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/map', label: 'Map' },
  { href: '/graph', label: 'Graph' },
  { href: '/trails', label: 'Trails' },
  { href: '/plan', label: 'Plan' },
  { href: '/me', label: 'Your memory' },
  { href: '/signin', label: 'Sign in' },
];

/**
 * Responsive header. Both variants are always rendered and shown/hidden via CSS `display` so the
 * server and client emit identical markup — using `useBreakpointValue` here branched the DOM and
 * caused an every-page hydration mismatch (R2 §2.1).
 */
export function SiteNav() {
  return (
    <Box as="header" borderBottomWidth="1px" px={{ base: 4, md: 8 }} py={3} bg="bg.panel">
      <Flex align="center" gap={6} maxW="6xl" mx="auto">
        <CLink asChild fontWeight="bold" color="blue.600" letterSpacing="wide">
          <NextLink href="/">TRAILGRAPH</NextLink>
        </CLink>
        <Spacer />

        {/* Desktop: inline links + theme toggle */}
        <Flex align="center" gap={6} display={{ base: 'none', md: 'flex' }}>
          {LINKS.map((l) => (
            <CLink key={l.href} asChild>
              <NextLink href={l.href}>{l.label}</NextLink>
            </CLink>
          ))}
          <ColorModeButton />
        </Flex>

        {/* Mobile: theme toggle + hamburger menu (both always rendered; shown via CSS) */}
        <Box display={{ base: 'flex', md: 'none' }} alignItems="center" gap={1}>
          <ColorModeButton />
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton aria-label="Open menu" variant="outline" size="sm">☰</IconButton>
            </Menu.Trigger>
            <Menu.Positioner>
              <Menu.Content>
                {LINKS.map((l) => (
                  <Menu.Item key={l.href} value={l.href} asChild>
                    <NextLink href={l.href}>{l.label}</NextLink>
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Box>
      </Flex>
    </Box>
  );
}
