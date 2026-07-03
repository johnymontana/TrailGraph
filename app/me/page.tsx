import { Box, Button, Container } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuBrain } from 'react-icons/lu';
import { getServerUserId } from '../../lib/session';
import { getUserMemory, userContextGraph } from '../../lib/memory-graph';
import { getHomeLocation } from '../../lib/bridges';
import { HomeLocationCard } from '../../components/memory/HomeLocationCard';
import { getLearningMemory } from '../../lib/learn-queries';
import { allBadges } from '../../lib/learn-badges';
import { MemoryList } from '../../components/memory/MemoryList';
import { ContextGraph } from '../../components/memory/ContextGraph';
import { CollectivePanel } from '../../components/memory/CollectivePanel';
import { LearningSummary } from '../../components/learn/LearningSummary';
import { DigestInbox } from '../../components/inbox/DigestInbox';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState } from '../../components/ui/empty-state';

/** "Your memory" (E3/E4) — view/feedback/delete remembered facts. §13.4 hard requirement. */
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const userId = await getServerUserId();
  if (!userId) {
    return (
      <Box maxW="3xl" mx="auto" px={{ base: 4, md: 8 }} py={24}>
        <EmptyState
          icon={<LuBrain />}
          title="Your memory lives here"
          description="Sign in to see and manage what TrailGraph remembers about you — preferences, considered parks, travel dates, and more."
        >
          <Button asChild colorPalette="pine" mt={2}>
            <NextLink href="/signin">Sign in</NextLink>
          </Button>
        </EmptyState>
      </Box>
    );
  }
  const [memory, context, learning, badges, home] = await Promise.all([
    getUserMemory(userId),
    userContextGraph(userId).catch(() => null),
    getLearningMemory(userId),
    allBadges(),
    getHomeLocation(userId).catch(() => null),
  ]);
  return (
    <Box>
      <PageHeader
        eyebrow="Your memory"
        title="What the ranger remembers"
        subtitle="Everything below shapes your recommendations. It can be wrong — edit, weight, or delete anything."
        contour
      />
      <Container maxW="3xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        {context ? <ContextGraph nodes={context.nodes} rels={context.rels} /> : null}
        <HomeLocationCard initial={home} />
        <MemoryList initial={memory} />
        <LearningSummary learning={learning} badges={badges} />
        <DigestInbox />
        <CollectivePanel />
      </Container>
    </Box>
  );
}
