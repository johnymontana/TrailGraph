'use client';
import { useEffect, useState } from 'react';
import { Box, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuInbox } from 'react-icons/lu';

/**
 * Nav inbox badge (Proactive Ranger, ADR-052) — shows the unread digest count and links to the /me
 * inbox. Rendered only when signed in (the parent nav gates on session), so the client-only fetch is safe.
 */
export function InboxBadge() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    fetch('/api/inbox')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setUnread(d.unread ?? 0);
      })
      .catch(() => {});
  }, []);

  return (
    <CLink asChild aria-label={`Inbox${unread ? ` (${unread} unread)` : ''}`} _hover={{ textDecoration: 'none' }}>
      <NextLink href="/me">
        <Box
          position="relative"
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize="32px"
          borderRadius="full"
          color="fg.muted"
          _hover={{ color: 'brand.fg', bg: 'brand.subtle' }}
        >
          <LuInbox />
          {unread > 0 ? (
            <Box
              position="absolute"
              top="0"
              right="0"
              minW="16px"
              h="16px"
              px="1"
              borderRadius="full"
              bg="trail.solid"
              color="trail.contrast"
              fontSize="10px"
              fontWeight="bold"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              {unread > 9 ? '9+' : unread}
            </Box>
          ) : null}
        </Box>
      </NextLink>
    </CLink>
  );
}
