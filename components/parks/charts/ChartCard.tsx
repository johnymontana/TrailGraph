'use client';
import { Card, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * Shared wrapper for the park-detail chart cards (ADR — park data-viz). A branded subtle Card with a
 * heading + optional caption, so every chart reads consistently. Charts pass precomputed data (the pure
 * shapers in `lib/park-charts.ts` run server-side); these components are the `'use client'` islands.
 */
export function ChartCard({ title, caption, children }: { title: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <Card.Root variant="subtle" size="sm" h="full">
      <Card.Body p={4}>
        <Text fontWeight="semibold" fontFamily="heading" fontSize="sm" mb={caption ? 0.5 : 3}>
          {title}
        </Text>
        {caption ? (
          <Text fontSize="xs" color="fg.muted" mb={3}>
            {caption}
          </Text>
        ) : null}
        {children}
      </Card.Body>
    </Card.Root>
  );
}
