import { Box, HStack, Icon, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';

export interface StatCardProps {
  /** Small uppercase eyebrow, e.g. "Dark sky", "Entrance fee". */
  label: string;
  /** The headline value, e.g. "Bortle 2", "$35 / vehicle". */
  value: ReactNode;
  /** Optional secondary line under the value. */
  hint?: ReactNode;
  /** Optional leading icon (react-icons component). */
  icon?: IconType;
  /** Tints the icon + value to convey status. Defaults to neutral. */
  tone?: 'brand' | 'accent' | 'neutral';
}

const toneColor = { brand: 'brand.fg', accent: 'accent.fg', neutral: 'fg.default' } as const;

/**
 * Compact "at a glance" stat tile — used in the park-detail stats row and trip cost/alert summaries.
 * Pure presentational; lay them out in a SimpleGrid. Renders the icon as a child (not `as={fn}`) so it
 * stays serializable when used inside Server Components (RSC can't pass a function to a client Icon).
 */
export function StatCard({ label, value, hint, icon, tone = 'neutral' }: StatCardProps) {
  const IconComp = icon;
  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={4}>
      <HStack gap={2} mb={1} align="center">
        {IconComp ? (
          <Icon color={tone === 'neutral' ? 'fg.subtle' : toneColor[tone]} boxSize={4}>
            <IconComp />
          </Icon>
        ) : null}
        <Text fontSize="xs" fontWeight="semibold" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">
          {label}
        </Text>
      </HStack>
      <Stack gap={0.5}>
        <Text fontFamily="heading" fontSize="lg" fontWeight="semibold" lineHeight="1.2" color={toneColor[tone]}>
          {value}
        </Text>
        {hint ? (
          <Text fontSize="xs" color="fg.muted">
            {hint}
          </Text>
        ) : null}
      </Stack>
    </Box>
  );
}
