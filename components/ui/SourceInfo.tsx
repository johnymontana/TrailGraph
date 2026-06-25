'use client';
import { Box, Icon, Popover, Portal, Text } from '@chakra-ui/react';
import { LuInfo } from 'react-icons/lu';

/**
 * A compact ⓘ affordance (P1.4) that surfaces a data tile's source / freshness / confidence on tap — so the
 * ranger's data-honesty is visible on the card itself, not only when a user thinks to challenge it. Static
 * copy (no fetch). Mirrors the WhyThisPark Popover/Portal pattern so it never clips inside a chat card.
 */
export function SourceInfo({ label, detail }: { label?: string; detail: string }) {
  return (
    <Popover.Root positioning={{ placement: 'top' }}>
      <Popover.Trigger asChild>
        <Box
          as="button"
          display="inline-flex"
          alignItems="center"
          color="fg.subtle"
          cursor="pointer"
          lineHeight="1"
          aria-label={label ? `About this data: ${label}` : 'About this data'}
          _hover={{ color: 'fg.muted' }}
        >
          <Icon boxSize={3.5}>
            <LuInfo />
          </Icon>
        </Box>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content maxW="xs">
            <Popover.Arrow>
              <Popover.ArrowTip />
            </Popover.Arrow>
            <Popover.Body>
              {label ? (
                <Popover.Title fontWeight="semibold" fontFamily="heading" mb={1} fontSize="sm">
                  {label}
                </Popover.Title>
              ) : null}
              <Text fontSize="xs" color="fg.muted">
                {detail}
              </Text>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
