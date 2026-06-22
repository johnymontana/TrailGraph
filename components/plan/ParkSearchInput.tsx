'use client';
import { useState, useRef, useEffect } from 'react';
import { Box, Input, Stack, Text, Spinner } from '@chakra-ui/react';

/**
 * Park name typeahead (§2.5) — search by name instead of requiring the 4-letter parkCode.
 * Debounced search against /api/graph?op=search&q=; pick a result → onSelect(parkCode).
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }

  return (
    <Box position="relative">
      <Input
        size="sm"
        placeholder="Search parks by name (e.g. Yellowstone)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
      />
      {open && (hits.length > 0 || loading) ? (
        <Box
          position="absolute"
          top="100%"
          left={0}
          right={0}
          mt={1}
          zIndex={10}
          bg="bg.panel"
          borderWidth="1px"
          borderRadius="md"
          shadow="md"
          maxH="220px"
          overflowY="auto"
        >
          {loading ? (
            <Box p={2}><Spinner size="xs" /></Box>
          ) : (
            <Stack gap={0}>
              {hits.map((h) => (
                <Box
                  key={h.parkCode}
                  px={3}
                  py={2}
                  cursor="pointer"
                  _hover={{ bg: 'bg.subtle' }}
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
