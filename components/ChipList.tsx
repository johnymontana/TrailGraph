'use client';
import { useState } from 'react';
import { Wrap, Badge, Button, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';

/**
 * Grouped, traversable chips (§4/§6): shows the top N, with "show all", and each chip links to
 * Explore filtered by that node — clicking "Geysers" finds other parks sharing it (graph traversal).
 */
export function ChipList({
  items,
  param,
  colorPalette = 'pine',
  initial = 10,
}: {
  items: string[];
  param: 'activity' | 'topic';
  colorPalette?: string;
  initial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, initial);
  return (
    <Wrap gap={2}>
      {shown.map((it) => (
        <CLink key={it} asChild _hover={{ textDecoration: 'none' }}>
          <NextLink href={`/explore?${param}=${encodeURIComponent(it)}`}>
            <Badge
              variant="subtle"
              colorPalette={colorPalette}
              px={2.5}
              py={1}
              cursor="pointer"
              transition="background 0.15s"
              _hover={{ bg: 'colorPalette.muted' }}
            >
              {it}
            </Badge>
          </NextLink>
        </CLink>
      ))}
      {items.length > initial ? (
        <Button size="xs" variant="ghost" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `+${items.length - initial} more`}
        </Button>
      ) : null}
    </Wrap>
  );
}
