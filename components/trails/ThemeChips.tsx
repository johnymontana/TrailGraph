'use client';
import { useState } from 'react';
import { Flex, Badge, Input, Button, Text, Link as CLink, Stack } from '@chakra-ui/react';
import NextLink from 'next/link';

export interface ThemeChipItem {
  key: string;
  label: string;
  parks: number;
  href: string;
  active: boolean;
}

/**
 * Trail theme chips (people/topics) with an optional filter and a collapse (ADR-039, friction #6). The
 * full list was silently capped at 24 with no "show all", so a long taxonomy looked complete when it
 * wasn't. We render all items but collapse to `initialCount`, with a search box to find the rest.
 */
export function ThemeChips({
  items,
  activeColor,
  initialCount = 24,
}: {
  items: ThemeChipItem[];
  activeColor: string;
  initialCount?: number;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  // While searching, show every match; otherwise collapse to the first N.
  const shown = q || expanded ? filtered : filtered.slice(0, initialCount);
  const hiddenCount = filtered.length - shown.length;

  return (
    <Stack gap={3}>
      {items.length > initialCount ? (
        <Input
          size="sm"
          maxW="xs"
          placeholder={`Search ${items.length} themes…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {shown.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">No themes match “{query}”.</Text>
      ) : (
        <Flex wrap="wrap" gap={2}>
          {shown.map((i) => (
            <CLink key={i.key} asChild>
              <NextLink href={i.href}>
                <Badge size="lg" colorPalette={i.active ? activeColor : 'gray'} px={3} py={1} cursor="pointer">
                  {i.label} <Text as="span" color="fg.muted">· {i.parks}</Text>
                </Badge>
              </NextLink>
            </CLink>
          ))}
        </Flex>
      )}
      {!q && hiddenCount > 0 ? (
        <Button size="xs" variant="ghost" alignSelf="start" onClick={() => setExpanded(true)}>
          Show all {filtered.length}
        </Button>
      ) : null}
      {!q && expanded && filtered.length > initialCount ? (
        <Button size="xs" variant="ghost" alignSelf="start" onClick={() => setExpanded(false)}>
          Show fewer
        </Button>
      ) : null}
    </Stack>
  );
}
