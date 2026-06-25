import { Badge, Box, Icon, SimpleGrid, Text } from '@chakra-ui/react';
import { LuAward, LuLock } from 'react-icons/lu';
import type { BadgeInfo } from '../../lib/learn-badges';

/**
 * The Junior Ranger badge collection — earned badges shown solid, locked ones desaturated with a lock
 * (the criteria surface as a hover title). RSC-safe (icons rendered as children, no function props).
 */
export function BadgeShelf({ badges, earnedIds }: { badges: BadgeInfo[]; earnedIds: string[] }) {
  if (!badges.length) return null;
  const earned = new Set(earnedIds);
  return (
    <SimpleGrid columns={{ base: 2, sm: 3, lg: 6 }} gap={3}>
      {badges.map((b) => {
        const has = earned.has(b.id);
        return (
          <Box
            key={b.id}
            borderWidth="1px"
            borderColor="border"
            borderRadius="l2"
            bg="bg.panel"
            p={3}
            textAlign="center"
            opacity={has ? 1 : 0.55}
            title={b.criteria ?? undefined}
          >
            <Icon boxSize={6} color={has ? 'trail.fg' : 'fg.subtle'} mb={1}>
              {has ? <LuAward /> : <LuLock />}
            </Icon>
            <Text fontSize="xs" fontWeight="medium" lineClamp={2}>{b.label}</Text>
            <Badge colorPalette={has ? 'trail' : 'sand'} size="sm" mt={1}>{has ? 'earned' : 'locked'}</Badge>
          </Box>
        );
      })}
    </SimpleGrid>
  );
}
