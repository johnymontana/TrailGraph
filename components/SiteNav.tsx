'use client';
import { useEffect, useState } from 'react';
import { Box, Flex, Link as CLink, Spacer, Menu, IconButton, Text } from '@chakra-ui/react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { ColorModeButton } from './ui/color-mode-button';
import { useSession, signOut } from '../lib/auth-client';

// Public browse links shown to everyone. Account/memory surfaces live in the account control (signed
// in) or behind the "Sign in" affordance (signed out) — see AccountControl.
const LINKS = [
  { href: '/explore', label: 'Explore' },
  { href: '/search', label: 'Search' },
  { href: '/map', label: 'Map' },
  { href: '/graph', label: 'Graph' },
  { href: '/trails', label: 'Trails' },
  { href: '/plan', label: 'Plan' },
];

// Account menu destinations (signed-in only).
const ACCOUNT_LINKS = [
  { href: '/me', label: 'Your memory' },
  { href: '/onboarding', label: 'Edit preferences' },
];

/**
 * Responsive header. Both desktop and mobile variants are always rendered and shown/hidden via CSS
 * `display` so the server and client emit identical markup — using `useBreakpointValue` here branched
 * the DOM and caused an every-page hydration mismatch (R2 §2.1).
 *
 * The auth state (account dropdown vs "Sign in") is unknown on the server, so — like `ColorModeButton`
 * (ADR-028) — the auth-dependent markup is gated on a `mounted` flag behind a neutral placeholder, so
 * SSR === first CSR and there's no mismatch.
 */
export function SiteNav() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const user = session?.user ?? null;
  const ready = mounted && !isPending;
  const email = user?.email ?? '';
  const initial = (email.trim()[0] ?? '?').toUpperCase();

  async function handleSignOut() {
    await signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <Box as="header" borderBottomWidth="1px" px={{ base: 4, md: 8 }} py={3} bg="bg.panel">
      <Flex align="center" gap={6} maxW="6xl" mx="auto">
        <CLink asChild fontWeight="bold" color="blue.600" letterSpacing="wide">
          <NextLink href="/">TRAILGRAPH</NextLink>
        </CLink>
        <Spacer />

        {/* Desktop: inline links + theme toggle + account control */}
        <Flex align="center" gap={6} display={{ base: 'none', md: 'flex' }}>
          {LINKS.map((l) => (
            <CLink key={l.href} asChild>
              <NextLink href={l.href}>{l.label}</NextLink>
            </CLink>
          ))}
          <ColorModeButton />
          {/* Neutral avatar-sized placeholder until auth resolves, so SSR === first CSR (no flash of
              the wrong state). */}
          {!ready ? (
            <Box boxSize="32px" borderRadius="full" bg="bg.subtle" suppressHydrationWarning />
          ) : user ? (
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton aria-label="Account menu" variant="ghost" size="sm" borderRadius="full">
                  <Box
                    boxSize="28px"
                    borderRadius="full"
                    bg="blue.600"
                    color="white"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    fontSize="sm"
                    fontWeight="bold"
                  >
                    {initial}
                  </Box>
                </IconButton>
              </Menu.Trigger>
              <Menu.Positioner>
                <Menu.Content>
                  <Box px={3} py={2}>
                    <Text fontSize="xs" color="fg.muted">Signed in as</Text>
                    <Text fontSize="sm" fontWeight="medium" lineClamp={1}>{email}</Text>
                  </Box>
                  {ACCOUNT_LINKS.map((l) => (
                    <Menu.Item key={l.href} value={l.href} asChild>
                      <NextLink href={l.href}>{l.label}</NextLink>
                    </Menu.Item>
                  ))}
                  <Menu.Item value="signout" onClick={handleSignOut}>Sign out</Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          ) : (
            <CLink asChild>
              <NextLink href="/signin">Sign in</NextLink>
            </CLink>
          )}
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
                {!ready ? null : user ? (
                  <>
                    <Box px={3} py={2} borderTopWidth="1px">
                      <Text fontSize="xs" color="fg.muted" lineClamp={1}>{email}</Text>
                    </Box>
                    {ACCOUNT_LINKS.map((l) => (
                      <Menu.Item key={l.href} value={l.href} asChild>
                        <NextLink href={l.href}>{l.label}</NextLink>
                      </Menu.Item>
                    ))}
                    <Menu.Item value="signout" onClick={handleSignOut}>Sign out</Menu.Item>
                  </>
                ) : (
                  <Menu.Item value="/signin" asChild>
                    <NextLink href="/signin">Sign in</NextLink>
                  </Menu.Item>
                )}
              </Menu.Content>
            </Menu.Positioner>
          </Menu.Root>
        </Box>
      </Flex>
    </Box>
  );
}
