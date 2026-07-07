import { redirect } from 'next/navigation';
import { Box, Heading } from '@chakra-ui/react';
import { getServerUserId } from '../../lib/session';
import { PlanShell } from '../../components/plan/PlanShell';

/**
 * Trip planner. The ranger + trip builder only do anything for a signed-in user (memory/trip writes are
 * userId-scoped and 401 otherwise), so we gate the whole surface behind sign-in rather than letting it
 * fail silently (ADR-038). Browse surfaces stay public.
 *
 * The layout is PlanShell (ADR-076): one client CSS grid — md+ "itinerary | map | chat", base a single
 * full-viewport pane behind a bottom tab bar. Everything mounts once (the Eve chat session isn't
 * duplicated; the maplibre canvas doesn't churn); pane visibility is CSS, never a breakpoint hook
 * (no `useBreakpointValue` markup branching — that caused an SSR↔CSR hydration mismatch, R2 §2.1).
 */
export default async function PlanPage() {
  const userId = await getServerUserId();
  if (!userId) redirect('/signin');

  return (
    <Box
      position="fixed"
      top="57px"
      left={0}
      right={0}
      data-fullscreen
      // dvh (not bottom:0/100vh) so the pane tracks the *dynamic* mobile viewport — with bottom:0 the
      // iOS/Android URL bar overlapped the chat input. @supports keeps a 100vh fallback for old browsers.
      css={{
        height: 'calc(100vh - 57px)',
        '@supports (height: 100dvh)': { height: 'calc(100dvh - 57px)' },
      }}
    >
      <Heading as="h1" srOnly>Plan a trip</Heading>
      <PlanShell />
    </Box>
  );
}
