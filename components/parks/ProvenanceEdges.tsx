'use client';
import { Badge, HStack, Icon, Stack, Text, Wrap } from '@chakra-ui/react';
import { LuArrowRight, LuCheck } from 'react-icons/lu';

/**
 * Renders the literal explanatory edges from `explainGraph` (ADR-047) as graph-sentence chips — shared
 * by the `WhyThisPark` popover and the `why_this` chat card so the two surfaces never diverge. Every
 * edge is read from the graph (R6); nothing here is model prose.
 */
export interface ProvenanceData {
  park?: string | null;
  prefPaths?: { name: string; kind: 'activity' | 'topic'; via: 'OFFERS' | 'HAS_TOPIC'; yourWords: string | null; weight: number | null }[];
  constraints?: { kind: 'wheelchair' | 'rv' | 'amenity'; label: string; satisfiedBy: string | null }[];
}

function Node({ children, tone }: { children: React.ReactNode; tone: 'pine' | 'trail' | 'sand' }) {
  return (
    <Badge colorPalette={tone} variant="surface" borderRadius="full" px={2}>
      {children}
    </Badge>
  );
}

export function ProvenanceEdges({ data }: { data: ProvenanceData }) {
  const prefPaths = data.prefPaths ?? [];
  const constraints = data.constraints ?? [];
  if (!prefPaths.length && !constraints.length) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No saved preferences connect you to this park yet — tell the ranger what you love.
      </Text>
    );
  }
  const park = data.park ?? 'this park';
  return (
    <Stack gap={2.5}>
      {prefPaths.map((p) => (
        <Stack key={`${p.kind}:${p.name}`} gap={0.5}>
          <Wrap gap={1.5} align="center">
            <Node tone="pine">You</Node>
            <Text as="span" fontSize="xs" color="fg.subtle">PREFERS</Text>
            <Icon as={LuArrowRight} boxSize={3} color="fg.subtle" />
            <Node tone="trail">{p.name}</Node>
            <Text as="span" fontSize="xs" color="fg.subtle">{p.via}</Text>
            <Icon as={LuArrowRight} boxSize={3} color="fg.subtle" transform="rotate(180deg)" />
            <Node tone="pine">{park}</Node>
          </Wrap>
          {p.yourWords ? (
            <Text fontSize="xs" color="fg.muted" pl={1}>
              — you said “{p.yourWords}”
            </Text>
          ) : null}
        </Stack>
      ))}
      {constraints.map((c) => (
        <HStack key={`${c.kind}:${c.label}`} gap={2} align="start">
          <Icon as={LuCheck} boxSize={4} color={c.satisfiedBy ? 'green.fg' : 'fg.subtle'} mt={0.5} flexShrink={0} />
          <Text fontSize="sm">
            {c.label}
            {c.satisfiedBy ? (
              <>
                {' → '}
                <Text as="span" color="fg.muted">{c.satisfiedBy}</Text>
              </>
            ) : (
              <Text as="span" color="fg.subtle"> (not found at this park)</Text>
            )}
          </Text>
        </HStack>
      ))}
    </Stack>
  );
}
