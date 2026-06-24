'use client';
import { useEffect, useRef, useState } from 'react';
import { Box, Flex, SimpleGrid, Skeleton, Slider, Spinner, Stack, Switch, Text } from '@chakra-ui/react';
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

/** Campground amenities offered as live-toggle chips (P1-4). These exist as `:Amenity {name}` nodes
 * (synthesized by the F3 campground-inventory sync) and filter via `REQUIRES`/the rank query. */
const CAMP_AMENITY_CHIPS = ['Dump Station', 'Showers', 'Potable Water', 'Cell Reception'];

/** The active /explore faceted filters — the live panel refines WITHIN these (ADR-046). */
export interface RankFacets {
  q?: string;
  stateCode?: string;
  activity?: string;
  topic?: string;
  amenity?: string;
  designation?: string;
  darkSky?: boolean;
}

/** Human summary of the active facets, e.g. "WY · Astronomy · dark-sky parks". */
function summarizeFacets(f: RankFacets): string {
  const parts = [
    f.q ? `“${f.q}”` : null,
    f.stateCode,
    f.activity,
    f.topic,
    f.amenity,
    f.designation,
    f.darkSky ? 'dark-sky parks' : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function RankPanel({ defaults, facets = {} }: { defaults: RankDefaults; facets?: RankFacets }) {
  const [mounted, setMounted] = useState(false);
  // Slider state. maxBortle: lower = darker; 9 = "any". crowd: 0..100 → 0..1.
  const [maxBortle, setMaxBortle] = useState(9);
  const [crowd, setCrowd] = useState(0);
  const [wheelchair, setWheelchair] = useState(defaults.wheelchairAccessible);
  const [rvFt, setRvFt] = useState(defaults.rvMaxLengthFt ?? 0);
  // Required amenities (P1-4): seed from the user's saved constraints, then toggle campground chips live.
  const [requiredAmenities, setRequiredAmenities] = useState<string[]>(defaults.requiredAmenities);
  const toggleAmenity = (a: string) =>
    setRequiredAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  // `null` = not loaded yet (first paint, before the initial fetch resolves) vs `[]` = loaded, no
  // matches. Distinguishing them kills the one-frame "0 matches" flash the test report flagged (§5.2):
  // we show a skeleton until the first response, never "no parks match".
  const [items, setItems] = useState<RankedPark[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch('/api/parks/rank', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            // Honor the active /explore facets so the live panel can't surface parks the faceted search
            // excluded (e.g. a filtered-out state) — the bug this fixes.
            q: facets.q || undefined,
            stateCode: facets.stateCode || undefined,
            activity: facets.activity || undefined,
            topic: facets.topic || undefined,
            amenity: facets.amenity || undefined,
            designation: facets.designation || undefined,
            darkSky: facets.darkSky || undefined,
            maxBortle: maxBortle < 9 ? maxBortle : undefined,
            crowdTolerance: crowd / 100,
            wheelchairAccessible: wheelchair || undefined,
            rvMaxLengthFt: rvFt > 0 ? rvFt : undefined,
            requiredAmenities,
            limit: 12,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { items: RankedPark[]; total: number };
          setItems(data.items);
          setTotal(data.total);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') throw err;
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [
    mounted,
    maxBortle,
    crowd,
    wheelchair,
    rvFt,
    requiredAmenities,
    facets.q,
    facets.stateCode,
    facets.activity,
    facets.topic,
    facets.amenity,
    facets.designation,
    facets.darkSky,
  ]);

  if (!mounted) return null; // SSR baseline is the GET form above; this is pure progressive enhancement.

  const facetSummary = summarizeFacets(facets);

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={{ base: 4, md: 5 }} mb={6}>
      <Text fontWeight="semibold" fontFamily="heading" mb={1}>
        Refine live
      </Text>
      <Text fontSize="sm" color="fg.muted" mb={facetSummary ? 1 : 4}>
        Drag to re-rank instantly — the graph filters and scores in one query.
      </Text>
      {facetSummary ? (
        <Text fontSize="xs" color="brand.fg" mb={4}>
          Refining within your filters: {facetSummary}
        </Text>
      ) : null}
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

      {/* Campground amenity chips (P1-4) — toggle to require an amenity; re-ranks live. */}
      <Box mt={4}>
        <Text fontSize="sm" color="fg.muted" mb={2}>Require campground amenities</Text>
        <Flex gap={2} wrap="wrap">
          {CAMP_AMENITY_CHIPS.map((a) => {
            const active = requiredAmenities.includes(a);
            return (
              <Box
                key={a}
                as="button"
                onClick={() => toggleAmenity(a)}
                px={3}
                py={1}
                borderRadius="full"
                borderWidth="1px"
                borderColor={active ? 'brand.solid' : 'border'}
                bg={active ? 'brand.muted' : 'transparent'}
                color={active ? 'brand.fg' : 'fg.muted'}
                fontSize="sm"
                cursor="pointer"
                transition="background 0.15s, border-color 0.15s"
                _hover={{ borderColor: 'brand.solid' }}
                aria-pressed={active}
              >
                {a}
              </Box>
            );
          })}
        </Flex>
      </Box>

      <Flex align="center" gap={2} mt={4} mb={2}>
        <Text fontSize="sm" color="fg.muted">
          {total == null
            ? 'Ranked by your preferences + filters · finding matches…'
            : `Ranked by your preferences + filters · ${total} match${total === 1 ? '' : 'es'}`}
        </Text>
        {loading ? <Spinner size="xs" /> : null}
      </Flex>
      {items == null ? (
        <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} gap={5}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} h="220px" borderRadius="l2" />
          ))}
        </SimpleGrid>
      ) : items.length ? (
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
