'use client';
import { motion } from 'motion/react';
import { Badge, Box, Heading, Stack, Text } from '@chakra-ui/react';
import NextImage from 'next/image';
import { Placeholder } from '../Placeholder';
import { springs } from '../../theme/motion';

/**
 * Park-detail hero as a client island (the page is an async RSC and can't host `motion`). Signature
 * motion B "card→hero" (ADR-044 §7.1): the hero image *settles* in (a subtle scale, `springs.morph`) and
 * carries a `layoutId` so the cross-route card→hero flight can be turned on via Next 16's View
 * Transitions API later (App Router does a full RSC navigation, so AnimatePresence alone can't do it —
 * ADR-044 honest limit). Hydration-safe: only the image scales (visible in SSR, no opacity flash); the
 * scrim + title render statically. Reduced motion → the global MotionConfig makes the scale instant.
 */
export function ParkHero({
  parkCode,
  name,
  designation,
  statesLabel,
  image,
}: {
  parkCode: string;
  name: string;
  designation: string | null;
  statesLabel: string;
  image: { url: string; altText?: string } | null;
}) {
  return (
    <Box
      position="relative"
      h={{ base: '280px', md: '400px' }}
      w="100%"
      mb={6}
      borderRadius="l3"
      overflow="hidden"
      css={{ viewTransitionName: `park-${parkCode}-hero` }}
    >
      <motion.div
        layoutId={`park-${parkCode}-hero`}
        initial={{ scale: 1.06 }}
        animate={{ scale: 1 }}
        transition={springs.morph}
        style={{ position: 'absolute', inset: 0 }}
      >
        {image?.url ? (
          <NextImage
            src={image.url}
            alt={image.altText ?? name}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <Placeholder name={parkCode} label={name} />
        )}
      </motion.div>
      <Box
        position="absolute"
        inset={0}
        style={{ background: 'linear-gradient(to top, rgba(11,46,30,0.92) 0%, rgba(11,46,30,0.30) 50%, transparent 78%)' }}
      />
      <Stack position="absolute" bottom={0} left={0} right={0} p={{ base: 5, md: 8 }} gap={2}>
        {designation ? (
          <Badge colorPalette="trail" variant="solid" alignSelf="start">
            {designation}
          </Badge>
        ) : null}
        <Heading as="h1" size={{ base: '2xl', md: '4xl' }} color="white" lineHeight="1.05" textShadow="0 2px 14px rgba(0,0,0,0.5)">
          {name}
        </Heading>
        {statesLabel ? (
          <Text color="whiteAlpha.900" fontSize="sm" textShadow="0 1px 8px rgba(0,0,0,0.6)">
            {statesLabel}
          </Text>
        ) : null}
      </Stack>
    </Box>
  );
}
