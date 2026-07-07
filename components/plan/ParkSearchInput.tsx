'use client';
import { useState, useRef, useEffect, useId } from 'react';
import { Box, Input, Stack, Text, Spinner } from '@chakra-ui/react';

/**
 * Park name typeahead (§2.5) — search by name instead of requiring the 4-letter parkCode.
 * Debounced search against /api/graph?op=search&q=; pick a result → onSelect(parkCode). Implements
 * listbox ARIA + arrow-key navigation so it's keyboard- and screen-reader-accessible.
 */
interface Hit {
  parkCode: string;
  name: string;
  designation: string;
}

export function ParkSearchInput({ onSelect }: { onSelect: (parkCode: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/graph?op=search&q=${encodeURIComponent(query)}`);
        const { parks } = (await res.json()) as { parks: Hit[] };
        setHits((parks ?? []).slice(0, 6));
        setActive(-1);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  function pick(code: string) {
    onSelect(code);
    setQ('');
    setHits([]);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || hits.length === 0) {
      if (e.key === 'ArrowDown' && hits.length) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(hits[active].parkCode);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <Box position="relative">
      <Input
        size="sm"
        fontSize={{ base: 'md', md: 'sm' }} // ≥16px on base or iOS Safari auto-zooms the focused input
        placeholder="Search parks by name (e.g. Yellowstone)"
        aria-label="Add a park to this trip"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (hits.length > 0 || loading) ? (
        <Box
          id={listId}
          role="listbox"
          position="absolute"
          top="100%"
          left={0}
          right={0}
          mt={1}
          zIndex={10}
          bg="bg.panel"
          borderWidth="1px"
          borderColor="border"
          borderRadius="l2"
          shadow="lg"
          maxH="240px"
          overflowY="auto"
        >
          {loading ? (
            <Box p={2}><Spinner size="xs" color="brand.solid" /></Box>
          ) : (
            <Stack gap={0}>
              {hits.map((h, i) => (
                <Box
                  key={h.parkCode}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  px={3}
                  py={{ base: 2.5, md: 2 }} // comfortable tap height on touch
                  cursor="pointer"
                  bg={i === active ? 'bg.subtle' : undefined}
                  _hover={{ bg: 'bg.subtle' }}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(h.parkCode)}
                >
                  <Text fontSize="sm" fontWeight="medium">{h.name}</Text>
                  <Text fontSize="xs" color="fg.muted">{h.designation}</Text>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
