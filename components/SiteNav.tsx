'use client';
import { useEffect, useState } from 'react';
import {
  Box,
  Drawer,
  Flex,
  HStack,
  Icon,
  IconButton,
  Menu,
  Portal,
  Spacer,
  Stack,
  Text,
  Link as CLink,
} from '@chakra-ui/react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LuMenu, LuMountainSnow, LuX } from 'react-icons/lu';
import { ColorModeButton } from './ui/color-mode-button';
import { InboxBadge } from './inbox/InboxBadge';
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

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
}

/**
 * Responsive header. Both desktop and mobile variants are always rendered and shown/hidden via CSS
 * `display` so the server and client emit identical markup — using `useBreakpointValue` here branched
 * the DOM and caused an every-page hydration mismatch (R2 §2.1).
 *
 * The auth state (account dropdown vs "Sign in") is unknown on the server, so — like `ColorModeButton`
 * (ADR-028) — the auth-dependent markup is gated on a `mounted` flag behind a neutral placeholder, so
 * SSR === first CSR and there's no mismatch.
 *
 * Height is held at ~57px (py=3 + size-sm controls); the full-screen /graph, /map, /plan pages offset
 * their fixed layouts by `top: 57px` and rely on it.
 */
export function SiteNav() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isActive = useIsActive();
  useEffect(() => setMounted(true), []);

  const user = session?.user ?? null;
  const ready = mounted && !isPending;
  const email = user?.email ?? '';
  const initial = (email.trim()[0] ?? '?').toUpperCase();

  async function handleSignOut() {
    setDrawerOpen(false);
    await signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <Box
      as="header"
      position="sticky"
      top={0}
      zIndex="docked"
      borderBottomWidth="1px"
      borderColor="border"
      px={{ base: 4, md: 8 }}
      py={3}
      bg="bg.panel/80"
      backdropFilter="saturate(180%) blur(10px)"
    >
      <Flex align="center" gap={6} maxW="6xl" mx="auto">
        <CLink asChild _hover={{ textDecoration: 'none' }}>
          <NextLink href="/">
            <HStack gap={2}>
              <Icon as={LuMountainSnow} color="brand.solid" boxSize={6} />
              <Text fontFamily="heading" fontWeight="bold" color="fg" letterSpacing="0.06em">
                TRAILGRAPH
              </Text>
            </HStack>
          </NextLink>
        </CLink>
        <Spacer />

        {/* Desktop: inline links + theme toggle + account control */}
        <Flex align="center" gap={1} display={{ base: 'none', md: 'flex' }}>
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <CLink
                key={l.href}
                asChild
                px={3}
                py={1.5}
                rounded="l2"
                fontSize="sm"
                fontWeight={active ? 'semibold' : 'medium'}
                color={active ? 'brand.fg' : 'fg.muted'}
                bg={active ? 'brand.subtle' : 'transparent'}
                _hover={{ textDecoration: 'none', color: 'brand.fg', bg: 'brand.subtle' }}
              >
                <NextLink href={l.href}>{l.label}</NextLink>
              </CLink>
            );
          })}
          <Box ml={2}>
            <ColorModeButton />
          </Box>
          {/* Ranger inbox badge — only when signed in (ADR-052). */}
          {ready && user ? <InboxBadge /> : null}
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
                    bg="brand.solid"
                    color="brand.contrast"
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
              <Portal>
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
              </Portal>
            </Menu.Root>
          ) : (
            <CLink asChild ml={1} px={3} py={1.5} rounded="l2" fontSize="sm" fontWeight="semibold" color="brand.fg" _hover={{ textDecoration: 'none', bg: 'brand.subtle' }}>
              <NextLink href="/signin">Sign in</NextLink>
            </CLink>
          )}
        </Flex>

        {/* Mobile: theme toggle + drawer trigger (both always rendered; shown via CSS) */}
        <HStack display={{ base: 'flex', md: 'none' }} gap={1}>
          <ColorModeButton />
          <Drawer.Root open={drawerOpen} onOpenChange={(e) => setDrawerOpen(e.open)} placement="end" size="xs">
            <Drawer.Trigger asChild>
              <IconButton aria-label="Open menu" variant="ghost" size="sm">
                <LuMenu />
              </IconButton>
            </Drawer.Trigger>
            <Portal>
              <Drawer.Backdrop />
              <Drawer.Positioner>
                <Drawer.Content bg="bg.panel">
                  <Drawer.Header borderBottomWidth="1px" borderColor="border">
                    <HStack gap={2}>
                      <Icon as={LuMountainSnow} color="brand.solid" boxSize={5} />
                      <Drawer.Title fontFamily="heading" letterSpacing="0.06em">TRAILGRAPH</Drawer.Title>
                    </HStack>
                    <Drawer.CloseTrigger asChild>
                      <IconButton aria-label="Close menu" variant="ghost" size="sm" position="absolute" top={3} insetEnd={3}>
                        <LuX />
                      </IconButton>
                    </Drawer.CloseTrigger>
                  </Drawer.Header>
                  <Drawer.Body py={4}>
                    <Stack gap={1}>
                      {LINKS.map((l) => {
                        const active = isActive(l.href);
                        return (
                          <CLink
                            key={l.href}
                            asChild
                            px={3}
                            py={2.5}
                            rounded="l2"
                            fontWeight={active ? 'semibold' : 'medium'}
                            color={active ? 'brand.fg' : 'fg'}
                            bg={active ? 'brand.subtle' : 'transparent'}
                            _hover={{ textDecoration: 'none', bg: 'bg.subtle' }}
                          >
                            <NextLink href={l.href} onClick={() => setDrawerOpen(false)}>{l.label}</NextLink>
                          </CLink>
                        );
                      })}
                    </Stack>

                    <Box borderTopWidth="1px" borderColor="border" mt={4} pt={4}>
                      {!ready ? null : user ? (
                        <Stack gap={1}>
                          <Text fontSize="xs" color="fg.muted" px={3} pb={1} lineClamp={1}>{email}</Text>
                          {ACCOUNT_LINKS.map((l) => (
                            <CLink
                              key={l.href}
                              asChild
                              px={3}
                              py={2.5}
                              rounded="l2"
                              color="fg"
                              _hover={{ textDecoration: 'none', bg: 'bg.subtle' }}
                            >
                              <NextLink href={l.href} onClick={() => setDrawerOpen(false)}>{l.label}</NextLink>
                            </CLink>
                          ))}
                          <Box
                            as="button"
                            textAlign="start"
                            px={3}
                            py={2.5}
                            rounded="l2"
                            color="fg"
                            _hover={{ bg: 'bg.subtle' }}
                            onClick={handleSignOut}
                          >
                            Sign out
                          </Box>
                        </Stack>
                      ) : (
                        <CLink
                          asChild
                          px={3}
                          py={2.5}
                          rounded="l2"
                          fontWeight="semibold"
                          color="brand.fg"
                          bg="brand.subtle"
                          display="block"
                          _hover={{ textDecoration: 'none' }}
                        >
                          <NextLink href="/signin" onClick={() => setDrawerOpen(false)}>Sign in</NextLink>
                        </CLink>
                      )}
                    </Box>
                  </Drawer.Body>
                </Drawer.Content>
              </Drawer.Positioner>
            </Portal>
          </Drawer.Root>
        </HStack>
      </Flex>
    </Box>
  );
}
