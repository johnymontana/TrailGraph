'use client';
import { Badge, HStack, Link as CLink, Stack, Text } from '@chakra-ui/react';
import NextLink from 'next/link';

/**
 * Community SQM leaderboard (Collective Intelligence v2, ADR-053) — parks ranked by median traveler-
 * submitted sky darkness. Anonymized aggregate (counts + medians, never identities). Presentational;
 * reused by the chat `leaderboard_card` and the /me collective panel.
 */
export interface LeaderboardEntry {
  parkCode: string;
  name: string;
  bortle: number | null;
  medianSqm: number;
  readings: number;
  contributors: number;
}

export function SkyLeaderboard({ entries, emptyHint }: { entries: LeaderboardEntry[]; emptyHint?: string }) {
  if (!entries.length) {
    return (
      <Text fontSize="sm" color="fg.muted">
        {emptyHint ?? 'No community readings yet — log one from any park page to start the leaderboard.'}
      </Text>
    );
  }
  return (
    <Stack gap={2}>
      {entries.map((e, i) => (
        <HStack key={e.parkCode} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2} gap={3}>
          <Badge colorPalette={i === 0 ? 'trail' : 'sand'} variant={i === 0 ? 'solid' : 'subtle'} borderRadius="full" minW="22px" justifyContent="center">
            {i + 1}
          </Badge>
          <CLink asChild flex="1" color="brand.fg" fontWeight="medium">
            <NextLink href={`/parks/${e.parkCode}`}>{e.name}</NextLink>
          </CLink>
          <Stack gap={0} align="end">
            <Text fontSize="sm" fontWeight="semibold" fontFamily="heading">
              SQM {e.medianSqm}
              {e.bortle != null ? (
                <Text as="span" fontSize="xs" color="fg.subtle" fontWeight="normal"> · Bortle {e.bortle}</Text>
              ) : null}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {e.readings} reading{e.readings === 1 ? '' : 's'} · {e.contributors} traveler{e.contributors === 1 ? '' : 's'}
            </Text>
          </Stack>
        </HStack>
      ))}
    </Stack>
  );
}
