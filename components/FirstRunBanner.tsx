'use client';
import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { Box, HStack, Stack, Text, Button, CloseButton } from '@chakra-ui/react';

const DISMISS_KEY = 'trailgraph:firstRunBannerDismissed';

/**
 * First-run nudge (ADR-038). Rendered by the homepage only for a signed-in user whose memory is still
 * empty, pointing at the one action that unlocks personalization: seed a few preferences. Dismissal is
 * remembered in `localStorage`. Mounted-gated so SSR (which can't read localStorage) === first CSR — no
 * hydration mismatch and no flash for users who've already dismissed it.
 */
export function FirstRunBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) !== '1') setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  }

  return (
    <Box borderWidth="1px" borderRadius="lg" bg="bg.subtle" p={4} mb={10} position="relative">
      <HStack justify="space-between" align="start" gap={4}>
        <Stack gap={3}>
          <Box>
            <Text fontWeight="semibold">Tell the ranger what you love</Text>
            <Text fontSize="sm" color="fg.muted">
              Seed a few favorites and your homepage, map, and recommendations start tailoring to you.
            </Text>
          </Box>
          <HStack gap={2} wrap="wrap">
            <Button asChild colorPalette="blue" size="sm"><NextLink href="/plan">Open the ranger</NextLink></Button>
            <Button asChild variant="outline" size="sm"><NextLink href="/onboarding">Pick interests</NextLink></Button>
          </HStack>
        </Stack>
        <CloseButton aria-label="Dismiss" size="sm" onClick={dismiss} />
      </HStack>
    </Box>
  );
}
