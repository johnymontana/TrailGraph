'use client';
import { useEffect, useState } from 'react';
import { Button, Popover, Portal, Spinner, Text } from '@chakra-ui/react';
import { LuNetwork } from 'react-icons/lu';
import { ProvenanceEdges, type ProvenanceData } from './ProvenanceEdges';

/**
 * "Why this park?" popover (ADR-047) — reads the literal explanatory edges from `/api/explain` on open
 * and renders them with the shared `ProvenanceEdges`. The differentiator vs. a chatbot: the reasoning
 * is the graph, made visible. Fetch-on-open keeps it off the SSR path.
 */
export function WhyThisPark({ parkCode, parkName }: { parkCode: string; parkName: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ProvenanceData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    fetch(`/api/explain?parkCode=${encodeURIComponent(parkCode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? { prefPaths: [], constraints: [] }))
      .catch(() => setData({ prefPaths: [], constraints: [] }))
      .finally(() => setLoading(false));
  }, [open, data, parkCode]);

  return (
    <Popover.Root open={open} onOpenChange={(e) => setOpen(e.open)} positioning={{ placement: 'bottom-start' }}>
      <Popover.Trigger asChild>
        <Button size="xs" variant="ghost" colorPalette="pine">
          <LuNetwork />
          Why this park?
        </Button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content maxW="sm">
            <Popover.Arrow>
              <Popover.ArrowTip />
            </Popover.Arrow>
            <Popover.Body>
              <Popover.Title fontWeight="semibold" fontFamily="heading" mb={2}>
                Why {parkName}?
              </Popover.Title>
              {loading || !data ? (
                <Text fontSize="sm" color="fg.muted">
                  <Spinner size="xs" mr={2} />
                  Reading the graph…
                </Text>
              ) : (
                <ProvenanceEdges data={data} />
              )}
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
