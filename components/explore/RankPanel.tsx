'use client';
import { useEffect, useRef, useState } from 'react';
import { Box, Flex, SimpleGrid, Slider, Spinner, Stack, Switch, Text } from '@chakra-ui/react';
import { ParkCard } from '../ParkCard';
import type { RankedPark } from '../../lib/recommend';

/**
 * Live constraint re-ranking panel (ADR-046) — the data-driven user's favorite toy. Dragging a slider
 * re-runs the structured graph query (`POST /api/parks/rank`) and re-ranks parks in real time, a thing a
 * vector store can't do cleanly. Progressive enhancement: rendered BELOW the no-JS GET form, which stays
 * the SSR baseline. The crowd slider IS the real "fewer crowds" signal (replacing the dropped chip).
 */
export interface RankDefaults {
  rvMaxLengthFt: number | null;
  wheelchairAccessible: boolean;
  requiredAmenities: string[];
}

export function RankPanel({ defaults }: { defaults: RankDefaults }) {
  const [mounted, setMounted] = useState(false);
  // Slider state. maxBortle: lower = darker; 9 = "any". crowd: 0..100 → 0..1.
  const [maxBortle, setMaxBortle] = useState(9);
  const [crowd, setCrowd] = useState(0);
  const [wheelchair, setWheelchair] = useState(defaults.wheelchairAccessible);
  const [rvFt, setRvFt] = useState(defaults.rvMaxLengthFt ?? 0);
  const [items, setItems] = useState<RankedPark[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/parks/rank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            maxBortle: maxBortle < 9 ? maxBortle : undefined,
            crowdTolerance: crowd / 100,
            wheelchairAccessible: wheelchair || undefined,
            rvMaxLengthFt: rvFt > 0 ? rvFt : undefined,
            requiredAmenities: defaults.requiredAmenities,
            limit: 12,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { items: RankedPark[]; total: number };
          setItems(data.items);
          setTotal(data.total);
        }
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mounted, maxBortle, crowd, wheelchair, rvFt, defaults.requiredAmenities]);

  if (!mounted) return null; // SSR baseline is the GET form above; this is pure progressive enhancement.

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={{ base: 4, md: 5 }} mb={6}>
      <Text fontWeight="semibold" fontFamily="heading" mb={1}>
        Refine live
      </Text>
      <Text fontSize="sm" color="fg.muted" mb={4}>
        Drag to re-rank instantly — the graph filters and scores in one query.
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={5}>
        <Slider.Root value={[maxBortle]} min={1} max={9} step={1} onValueChange={(d) => setMaxBortle(d.value[0])}>
          <Flex justify="space-between">
            <Slider.Label>Dark-sky quality</Slider.Label>
            <Text fontSize="xs" color="fg.muted">
              {maxBortle >= 9 ? 'any' : `Bortle ≤ ${maxBortle} (darker = lower)`}
            </Text>
          </Flex>
          <Slider.Control>
            <Slider.Track>
              <Slider.Range />
            </Slider.Track>
            <Slider.Thumb index={0}>
              <Slider.HiddenInput />
            </Slider.Thumb>
          </Slider.Control>
        </Slider.Root>

        <Slider.Root value={[crowd]} min={0} max={100} step={5} onValueChange={(d) => setCrowd(d.value[0])}>
          <Flex justify="space-between">
            <Slider.Label>Prefer fewer crowds</Slider.Label>
            <Text fontSize="xs" color="fg.muted">{crowd === 0 ? 'no preference' : `${crowd}%`}</Text>
          </Flex>
          <Slider.Control>
            <Slider.Track>
              <Slider.Range />
            </Slider.Track>
            <Slider.Thumb index={0}>
              <Slider.HiddenInput />
            </Slider.Thumb>
          </Slider.Control>
        </Slider.Root>

        <Slider.Root value={[rvFt]} min={0} max={45} step={1} onValueChange={(d) => setRvFt(d.value[0])}>
          <Flex justify="space-between">
            <Slider.Label>Fits my RV / van</Slider.Label>
            <Text fontSize="xs" color="fg.muted">{rvFt === 0 ? 'off' : `${rvFt} ft`}</Text>
          </Flex>
          <Slider.Control>
            <Slider.Track>
              <Slider.Range />
            </Slider.Track>
            <Slider.Thumb index={0}>
              <Slider.HiddenInput />
            </Slider.Thumb>
          </Slider.Control>
        </Slider.Root>

        <Switch.Root checked={wheelchair} onCheckedChange={(d) => setWheelchair(d.checked)} colorPalette="pine">
          <Switch.HiddenInput />
          <Switch.Control />
          <Switch.Label>Wheelchair-accessible camping</Switch.Label>
        </Switch.Root>
      </SimpleGrid>

      <Flex align="center" gap={2} mt={4} mb={2}>
        <Text fontSize="sm" color="fg.muted">
          Ranked by your preferences + filters · {total} match{total === 1 ? '' : 'es'}
        </Text>
        {loading ? <Spinner size="xs" /> : null}
      </Flex>
      {items.length ? (
        <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
          {items.map((p) => (
            <Stack key={p.parkCode} gap={1}>
              <ParkCard park={p} />
              {p.crowdLevel ? (
                <Text fontSize="xs" color="fg.subtle">
                  {p.crowdLevel} crowds{p.bortleScale != null ? ` · Bortle ${p.bortleScale}` : ''}
                </Text>
              ) : null}
            </Stack>
          ))}
        </SimpleGrid>
      ) : (
        <Text fontSize="sm" color="fg.muted">No parks match these constraints — loosen a slider.</Text>
      )}
    </Box>
  );
}
