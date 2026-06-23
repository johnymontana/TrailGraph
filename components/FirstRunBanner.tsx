'use client';
import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { Box, CloseButton, HStack, Icon, Stack, Text, Button } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { heroContourTexture } from '../theme/textures';

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
    <Box
      borderWidth="1px"
      borderColor="brand.muted"
      borderRadius="l2"
      bg="brand.subtle"
      backgroundImage={heroContourTexture}
      p={5}
      position="relative"
      overflow="hidden"
    >
      <HStack justify="space-between" align="start" gap={4}>
        <HStack align="start" gap={4}>
          <Box boxSize={10} borderRadius="l2" bg="brand.solid" color="brand.contrast" display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
            <Icon as={LuSparkles} boxSize={5} />
          </Box>
          <Stack gap={3}>
            <Box>
              <Text fontWeight="semibold" fontFamily="heading">Tell the ranger what you love</Text>
              <Text fontSize="sm" color="fg.muted">
                Seed a few favorites and your homepage, map, and recommendations start tailoring to you.
              </Text>
            </Box>
            <HStack gap={2} wrap="wrap">
              <Button asChild colorPalette="pine" size="sm"><NextLink href="/plan">Open the ranger</NextLink></Button>
              <Button asChild colorPalette="pine" variant="outline" size="sm"><NextLink href="/onboarding">Pick interests</NextLink></Button>
            </HStack>
          </Stack>
        </HStack>
        <CloseButton aria-label="Dismiss" size="sm" onClick={dismiss} />
      </HStack>
    </Box>
  );
}
