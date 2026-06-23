import { Badge, Flex, Heading, HStack, Text, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import type { ReactNode } from 'react';

export interface SectionHeadingProps {
  title: ReactNode;
  /** Optional badge text shown beside the title (e.g. "based on your preferences"). */
  badge?: ReactNode;
  badgeTone?: 'brand' | 'accent' | 'neutral';
  /** Optional supporting line under the title. */
  description?: ReactNode;
  /** Optional trailing action link. */
  action?: { href: string; label: string };
  size?: 'md' | 'lg';
}

const badgePalette = { brand: 'pine', accent: 'trail', neutral: 'sand' } as const;

/** Consistent section header used across pages — title (+ optional badge), description, and trailing link. */
export function SectionHeading({ title, badge, badgeTone = 'brand', description, action, size = 'md' }: SectionHeadingProps) {
  return (
    <Flex justify="space-between" align={{ base: 'start', sm: 'end' }} gap={3} mb={4} direction={{ base: 'column', sm: 'row' }}>
      <div>
        <HStack gap={2} align="center" wrap="wrap">
          <Heading as="h2" size={size === 'lg' ? 'xl' : 'lg'}>
            {title}
          </Heading>
          {badge ? <Badge colorPalette={badgePalette[badgeTone]}>{badge}</Badge> : null}
        </HStack>
        {description ? (
          <Text color="fg.muted" mt={1} fontSize="sm">
            {description}
          </Text>
        ) : null}
      </div>
      {action ? (
        <CLink asChild fontSize="sm" fontWeight="medium" color="brand.fg" whiteSpace="nowrap" _hover={{ textDecoration: 'underline' }}>
          <NextLink href={action.href}>{action.label} →</NextLink>
        </CLink>
      ) : null}
    </Flex>
  );
}
