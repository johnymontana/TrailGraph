'use client';
import { useEffect, useState } from 'react';
import { Box, Button, HStack, Stack, Text } from '@chakra-ui/react';

interface Insights {
  communities: { id: number; label: string; size: number; parkCodes: string[] }[];
  central: { parkCode: string; name: string; score: number }[];
  bridges: { parkCode: string; name: string; bridges: number; betweenness: number }[];
}

/**
 * Graph analytics surface (#7): emergent communities ("Show this cluster" highlights members), most-central
 * parks (PageRank), and bridge parks (betweenness). Reads the cached /api/graph/analytics feed; renders
 * NOTHING when analytics haven't been computed (no GDS / not yet synced), so it never clutters an empty graph.
 */
export function InsightsPanel({
  onShowCluster,
  onSelectPark,
  activeClusterId,
  onClearCluster,
}: {
  onShowCluster: (id: number, parkCodes: string[]) => void;
  onSelectPark: (parkCode: string) => void;
  activeClusterId: number | null;
  onClearCluster: () => void;
}) {
  const [data, setData] = useState<Insights | null>(null);
  const [open, setOpen] = useState(true); // open by default so the panel is visible once analytics exist

  useEffect(() => {
    let alive = true;
    fetch('/api/graph/analytics')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setData(d as Insights);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const has = data && (data.communities.length > 0 || data.central.length > 0 || data.bridges.length > 0);
  if (!has) return null;

  const SectionLabel = ({ children }: { children: string }) => (
    <Text fontSize="2xs" fontWeight="bold" color="fg.muted" textTransform="uppercase" letterSpacing="wide">
      {children}
    </Text>
  );

  return (
    <Box position="absolute" top="124px" left={3} zIndex={1} bg="bg.panel/90" backdropFilter="blur(8px)" borderWidth="1px" borderColor="border" borderRadius="l2" px={3} py={2} shadow="md" maxW="60" data-testid="graph-insights">
      <HStack justify="space-between" gap={2}>
        <Button size="xs" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? '▾' : '▸'} Insights
        </Button>
        {activeClusterId != null ? (
          <Button size="xs" variant="outline" onClick={onClearCluster}>
            Clear
          </Button>
        ) : null}
      </HStack>
      {open ? (
        <Stack gap={3} mt={2} maxH="58vh" overflowY="auto">
          {data!.communities.length ? (
            <Box>
              <SectionLabel>Themes</SectionLabel>
              <Stack gap={1} mt={1}>
                {data!.communities.map((c) => (
                  <HStack key={c.id} justify="space-between" gap={2}>
                    <Text fontSize="xs" lineClamp={1}>
                      {c.label}{' '}
                      <Text as="span" color="fg.muted">
                        ({c.parkCodes.length})
                      </Text>
                    </Text>
                    <Button size="xs" variant={activeClusterId === c.id ? 'solid' : 'outline'} colorPalette="pine" onClick={() => onShowCluster(c.id, c.parkCodes)}>
                      Show
                    </Button>
                  </HStack>
                ))}
              </Stack>
            </Box>
          ) : null}
          {data!.central.length ? (
            <Box>
              <SectionLabel>Most central</SectionLabel>
              <Stack gap={0.5} mt={1}>
                {data!.central.map((p) => (
                  <Text key={p.parkCode} fontSize="xs" cursor="pointer" _hover={{ color: 'pine.fg' }} onClick={() => onSelectPark(p.parkCode)}>
                    {p.name}
                  </Text>
                ))}
              </Stack>
            </Box>
          ) : null}
          {data!.bridges.length ? (
            <Box>
              <SectionLabel>Bridges</SectionLabel>
              <Stack gap={0.5} mt={1}>
                {data!.bridges.map((p) => (
                  <Text key={p.parkCode} fontSize="xs" cursor="pointer" _hover={{ color: 'pine.fg' }} onClick={() => onSelectPark(p.parkCode)}>
                    {p.name}{' '}
                    <Text as="span" color="fg.muted">
                      · {p.bridges}
                    </Text>
                  </Text>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}
