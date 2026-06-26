'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge, Box, HStack, Input, Stack, Text } from '@chakra-ui/react';

export interface NodeHit {
  kind: string;
  label: string;
  key: string;
  name: string;
  subtitle?: string;
}

/**
 * Find-any-node search for /graph (#3). Debounced typeahead against /api/graph/search (parks/places/
 * people/topics/activities); selecting a hit hands its {label, key} to the parent, which fetches its
 * ego-network. Reuses the embed-once search pipeline; renders a grouped-ish flat dropdown.
 */
export function GraphSearchBox({ onSelect }: { onSelect: (hit: NodeHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<NodeHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setHits([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/graph/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d) => {
          if (alive) {
            setHits(d.hits ?? []);
            setOpen(true);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <Box ref={boxRef} position="relative" data-testid="graph-search">
      <Input
        size="xs"
        placeholder="Find a park, person, place, topic…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        aria-label="Find a node"
      />
      {open && hits.length > 0 ? (
        <Stack position="absolute" top="100%" left={0} right={0} mt={1} bg="bg.panel" borderWidth="1px" borderColor="border" borderRadius="l2" shadow="lg" maxH="60vh" overflowY="auto" gap={0} zIndex={3}>
          {hits.map((h) => (
            <HStack
              key={`${h.label}:${h.key}`}
              px={2}
              py={1.5}
              gap={2}
              justify="space-between"
              cursor="pointer"
              _hover={{ bg: 'bg.muted' }}
              onClick={() => {
                onSelect(h);
                setOpen(false);
                setQ(h.name);
              }}
            >
              <Box minW={0}>
                <Text fontSize="xs" lineClamp={1}>{h.name}</Text>
                {h.subtitle ? (
                  <Text fontSize="2xs" color="fg.muted" lineClamp={1}>{h.subtitle}</Text>
                ) : null}
              </Box>
              <Badge size="sm" variant="subtle" colorPalette="pine">{h.label}</Badge>
            </HStack>
          ))}
        </Stack>
      ) : null}
      {loading && q.trim().length >= 3 ? (
        <Text position="absolute" right={2} top={1.5} fontSize="2xs" color="fg.muted">…</Text>
      ) : null}
    </Box>
  );
}
