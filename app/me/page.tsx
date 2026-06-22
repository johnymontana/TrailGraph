import { Box, Heading, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { getServerUserId } from '../../lib/session';
import { getUserMemory } from '../../lib/memory-graph';
import { MemoryList } from '../../components/memory/MemoryList';
import { CollectivePanel } from '../../components/memory/CollectivePanel';

/** "Your memory" (E3/E4) — view/feedback/delete remembered facts. §13.4 hard requirement. */
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const userId = await getServerUserId();
  if (!userId) {
    return (
      <Box maxW="3xl" mx="auto" px={{ base: 4, md: 8 }} py={16}>
        <Heading as="h1" size="lg" mb={2}>Your memory</Heading>
        <Text color="fg.muted">
          <CLink asChild color="blue.600"><NextLink href="/signin">Sign in</NextLink></CLink> to see and manage what TrailGraph remembers about you.
        </Text>
      </Box>
    );
  }
  const memory = await getUserMemory(userId);
  return (
    <Box maxW="3xl" mx="auto" px={{ base: 4, md: 8 }} py={8}>
      <Heading as="h1" size="lg" mb={6}>Your memory</Heading>
      <MemoryList initial={memory} />
      <CollectivePanel />
    </Box>
  );
}
