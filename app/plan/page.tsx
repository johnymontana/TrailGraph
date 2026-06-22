import { redirect } from 'next/navigation';
import { Flex, Box, Heading } from '@chakra-ui/react';
import { getServerUserId } from '../../lib/session';
import { TripBuilder } from '../../components/plan/TripBuilder';
import { ChatPanel } from '../../components/chat/ChatPanel';

/**
 * Trip planner. The ranger + trip builder only do anything for a signed-in user (memory/trip writes are
 * userId-scoped and 401 otherwise), so we gate the whole surface behind sign-in rather than letting it
 * fail silently (ADR-038). Browse surfaces stay public.
 *
 * Single responsive layout (no `useBreakpointValue` branching — that caused an SSR↔CSR hydration
 * mismatch, R2 §2.1): desktop is a two-pane row; mobile stacks the builder above the chat, each panel
 * scrollable. Both panels mount exactly once (the Eve chat session isn't duplicated).
 */
export default async function PlanPage() {
  const userId = await getServerUserId();
  if (!userId) redirect('/signin');

  return (
    <Flex
      position="fixed"
      top="57px"
      left={0}
      right={0}
      bottom={0}
      direction={{ base: 'column', md: 'row' }}
    >
      <Heading as="h1" srOnly>Plan a trip</Heading>
      <Box
        w={{ base: '100%', md: '380px' }}
        h={{ base: '50%', md: '100%' }}
        borderRightWidth={{ md: '1px' }}
        borderBottomWidth={{ base: '1px', md: 0 }}
      >
        <TripBuilder />
      </Box>
      <Box flex="1" h={{ base: '50%', md: '100%' }} minH={0}>
        <ChatPanel />
      </Box>
    </Flex>
  );
}
